const { execSync, execFileSync } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

const TOKEN_EVENTS = new Set(["Stop", "SubagentStop", "StopFailure"]);

const contextSize = (u) =>
  (u.input_tokens || 0) +
  (u.cache_creation_input_tokens || 0) +
  (u.cache_read_input_tokens || 0);

const EVENT_CONFIG = {
  Stop: {
    title: "Claude Code 完成",
    message: "Agent 已完成响应",
    sound: "Glass",
  },
  TaskCompleted: {
    title: "任务完成",
    message: "任务已完成",
    sound: "Hero",
  },
  Notification: {
    title: "Claude Code 通知",
    message: "需要你的注意",
    sound: "Ping",
  },
  PostToolUseFailure: {
    title: "工具执行失败",
    message: "工具执行出错",
    sound: "Basso",
  },
  SubagentStop: {
    title: "子代理完成",
    message: "子代理已完成任务",
    sound: "Purr",
  },
  StopFailure: {
    title: "Claude Code 错误",
    message: "Claude Code 遇到错误中断",
    sound: "Sosumi",
  },
};

const ERROR_TYPE_LABELS = {
  rate_limit: "请求频率限制",
  authentication_failed: "认证失败",
  billing_error: "账单/额度问题",
  server_error: "服务器错误",
  max_output_tokens: "输出超出 token 限制",
  invalid_request: "无效请求",
  unknown: "未知错误",
};

/**
 * 提取本轮任务的 token 消耗
 *
 * 采用 context-delta 口径：
 *   newInput = 回合结束时上下文大小 - 回合开始前上下文大小
 *   output   = 回合内所有 assistant 消息的 output_tokens 累加
 *   total    = newInput + output
 *
 * "上下文大小" 指单次 API 调用的 input + cache_creation + cache_read。
 * 不直接累加 cache_creation，否则缓存失效重建时会把整段历史误算作新增。
 *
 * 子代理通过 progress 条目转发，按 message.id 去重（progress 会重复触发同一 id 5~8 次）。
 */
function extractTokenUsage(lines) {
  // 单次反向扫描：先找最后一条真实 user 消息，再继续往前找它之前最近的主代理 assistant
  let startIdx = 0;
  let prevContext = 0;
  let foundUser = false;
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!entry) continue;

    if (!foundUser) {
      if (
        entry.type === "user" &&
        !entry.data &&
        !entry.isSidechain
      ) {
        const content = entry.message?.content;
        const isRealUser =
          typeof content === "string" ||
          (Array.isArray(content) &&
            content.some((b) => b?.type !== "tool_result"));
        if (isRealUser) {
          startIdx = i + 1;
          foundUser = true;
        }
      }
      continue;
    }

    if (entry.type === "assistant" && entry.message?.usage) {
      prevContext = contextSize(entry.message.usage);
      break;
    }
  }

  // 前向扫描：累加回合内 output、计数子代理、记录最后一条主代理 usage
  const seen = new Set();
  let lastMainUsage = null;
  let output = 0;
  let subCount = 0;

  for (let i = startIdx; i < lines.length; i++) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!entry) continue;

    let msgId = null;
    let usage = null;
    let isSub = false;

    if (entry.type === "assistant" && entry.message?.usage) {
      msgId = entry.message.id;
      usage = entry.message.usage;
    } else if (entry.type === "progress") {
      const inner = entry.data?.message;
      if (inner?.type === "assistant" && inner.message?.usage) {
        msgId = inner.message.id;
        usage = inner.message.usage;
        isSub = true;
      }
    }

    if (!usage || !msgId || seen.has(msgId)) continue;
    seen.add(msgId);

    output += usage.output_tokens || 0;
    if (isSub) subCount++;
    else lastMainUsage = usage;
  }

  if (seen.size === 0) return null;

  const currentContext = lastMainUsage ? contextSize(lastMainUsage) : prevContext;
  const newInput = Math.max(0, currentContext - prevContext);
  return {
    output,
    total: newInput + output,
    subCount,
  };
}

/**
 * 将 token 数字格式化为紧凑字符串（>=1000 显示为 k）
 */
function formatTokens(n) {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

/**
 * 从 hook 输入中提取有用信息
 */
function extractContext(hookInput) {
  const ctx = {};

  // 项目目录
  ctx.project = path.basename(process.cwd());

  // 任务主题 (TaskCompleted 事件)
  if (hookInput.task_subject) {
    ctx.taskSubject = hookInput.task_subject;
  }

  // 工具名称 (PostToolUseFailure 事件)
  if (hookInput.tool_name) {
    ctx.toolName = hookInput.tool_name;
  }

  // 错误类型 (StopFailure 事件)
  if (hookInput.error_type) {
    ctx.errorType = hookInput.error_type;
  }

  // 错误消息 (StopFailure 事件)
  if (hookInput.error_message) {
    ctx.errorMessage = hookInput.error_message;
  }

  // 停止原因 (Stop 事件)
  if (hookInput.stop_reason) {
    ctx.stopReason = hookInput.stop_reason;
  }

  // 读取 transcript 一次，供 lastMessage + tokenUsage 共享
  let lines = null;
  if (hookInput.transcript_path) {
    try {
      lines = fs
        .readFileSync(hookInput.transcript_path, "utf-8")
        .split("\n")
        .filter(Boolean);
    } catch {
      // 读取失败，忽略
    }
  }

  if (lines) {
    // 末尾若干行内找最后一条 assistant 文本消息
    const tailStart = Math.max(0, lines.length - 20);
    for (let i = lines.length - 1; i >= tailStart; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (
          entry?.message?.role === "assistant" &&
          entry?.message?.content?.[0]?.text
        ) {
          ctx.lastMessage = entry.message.content[0].text
            .replace(/\n/g, " ")
            .slice(0, 100);
          break;
        }
      } catch {
        continue;
      }
    }

    ctx.tokenUsage = extractTokenUsage(lines);
  }

  return ctx;
}

/**
 * 构建通知标题和消息
 */
function buildNotification({ event, title, message, hookInput }) {
  const config = EVENT_CONFIG[event] || EVENT_CONFIG.Stop;
  const ctx = extractContext(hookInput || {});

  let finalTitle = title || `${config.title} (${ctx.project})`;
  let finalMessage = message;

  if (!finalMessage) {
    if (event === "StopFailure" && ctx.errorType) {
      const label = ERROR_TYPE_LABELS[ctx.errorType] || ctx.errorType;
      finalTitle = `${config.title}: ${label} (${ctx.project})`;
      finalMessage = ctx.errorMessage || config.message;
    } else if (event === "Stop" && ctx.stopReason === "max_tokens") {
      finalTitle = `Claude Code 响应截断 (${ctx.project})`;
      finalMessage = "响应达到最大 token 限制被截断";
    } else if (event === "TaskCompleted" && ctx.taskSubject) {
      finalMessage = ctx.taskSubject;
    } else if (event === "PostToolUseFailure" && ctx.toolName) {
      finalMessage = `工具 ${ctx.toolName} 执行失败`;
    } else if (ctx.lastMessage) {
      finalMessage = ctx.lastMessage;
    } else {
      finalMessage = config.message;
    }
  }

  // 完成类事件提取 token 消耗字符串（由调用方决定放置位置）
  let tokenStr = "";
  if (TOKEN_EVENTS.has(event) && ctx.tokenUsage) {
    const u = ctx.tokenUsage;
    tokenStr = `本次任务消耗 ${formatTokens(u.total)} tokens`;
    if (u.subCount > 0) {
      tokenStr += ` · 子代理 ${u.subCount}`;
    }
  }

  return { title: finalTitle, message: finalMessage, sound: config.sound, tokenStr };
}

/**
 * 检测命令是否存在
 */
function commandExists(cmd) {
  try {
    execSync(
      os.platform() === "win32" ? `where ${cmd}` : `command -v ${cmd}`,
      { stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 发送系统桌面通知
 */
async function sendNotification(options = {}) {
  const {
    event = "Stop",
    title: customTitle,
    message: customMessage,
    sound: customSound,
    dryRun = false,
    hookInput = {},
  } = options;

  const {
    title,
    message,
    sound: defaultSound,
    tokenStr,
  } = buildNotification({
    event,
    title: customTitle,
    message: customMessage,
    hookInput,
  });
  const sound = customSound || defaultSound;

  const platform = os.platform();
  // 非 Windows 平台无顶部栏，把 token 信息追加到消息正文
  const displayMessage =
    platform !== "win32" && tokenStr ? `${message} · ${tokenStr}` : message;
  let method = "unknown";
  let command = "";
  let args = [];
  let tmpFile = null;

  if (platform === "darwin") {
    // macOS
    if (commandExists("terminal-notifier")) {
      method = "terminal-notifier";
      command = "terminal-notifier";
      args = [
        "-title",
        title,
        "-message",
        displayMessage,
        "-sound",
        sound,
        "-group",
        `claude-code-${path.basename(process.cwd())}`,
      ];
    } else {
      method = "osascript";
      command = "osascript";
      const escaped = displayMessage.replace(/"/g, '\\"');
      const escapedTitle = title.replace(/"/g, '\\"');
      args = [
        "-e",
        `display notification "${escaped}" with title "${escapedTitle}" sound name "${sound}"`,
      ];
    }
  } else if (platform === "linux") {
    method = "notify-send";
    command = "notify-send";
    args = [title, displayMessage, "--urgency=normal", "--expire-time=5000"];
    if (!commandExists("notify-send")) {
      const result = {
        sent: false,
        method: "none",
        error:
          "notify-send 未安装。请运行: sudo apt-get install libnotify-bin",
      };
      if (dryRun) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.error(result.error);
      }
      return result;
    }
  } else if (platform === "win32") {
    // SnoreToast: 原生 Windows Toast 通知，UTF-16 支持，不抢焦点
    // token 信息拼到 appID，会显示在顶部应用名栏
    method = "snoretoast";
    const arch = os.arch() === "x64" ? "x64" : "x86";
    command = path.join(__dirname, "..", "vendor", "snoretoast", `snoretoast-${arch}.exe`);
    const appID = tokenStr ? `Claude Code · ${tokenStr}` : "Claude.Code";
    args = ["-t", title, "-m", message, "-appID", appID];
  }

  const result = { sent: !dryRun, method, command, args };

  if (dryRun) {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
    result.sent = false;
    console.log(JSON.stringify(result, null, 2));
    return result;
  }

  try {
    if (command) {
      execFileSync(command, args, { stdio: "ignore", timeout: 8000 });
    }
  } catch (err) {
    result.sent = false;
    result.error = err.message;
  } finally {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  return result;
}

module.exports = { sendNotification, EVENT_CONFIG };
