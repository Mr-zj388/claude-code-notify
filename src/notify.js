const { execSync } = require("child_process");
const os = require("os");
const fs = require("fs");
const path = require("path");

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

  // 尝试从 transcript 提取最后的 assistant 消息
  if (hookInput.transcript_path && fs.existsSync(hookInput.transcript_path)) {
    try {
      const lines = fs
        .readFileSync(hookInput.transcript_path, "utf-8")
        .split("\n")
        .filter(Boolean)
        .slice(-20);

      for (let i = lines.length - 1; i >= 0; i--) {
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
    } catch {
      // 读取失败，忽略
    }
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

  return { title: finalTitle, message: finalMessage, sound: config.sound };
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
  } = buildNotification({
    event,
    title: customTitle,
    message: customMessage,
    hookInput,
  });
  const sound = customSound || defaultSound;

  const platform = os.platform();
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
        message,
        "-sound",
        sound,
        "-group",
        `claude-code-${extractContext(hookInput).project}`,
      ];
    } else {
      method = "osascript";
      command = "osascript";
      const escaped = message.replace(/"/g, '\\"');
      const escapedTitle = title.replace(/"/g, '\\"');
      args = [
        "-e",
        `display notification "${escaped}" with title "${escapedTitle}" sound name "${sound}"`,
      ];
    }
  } else if (platform === "linux") {
    method = "notify-send";
    command = "notify-send";
    args = [title, message, "--urgency=normal", "--expire-time=5000"];
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
    method = "snoretoast";
    const arch = os.arch() === "x64" ? "x64" : "x86";
    command = path.join(__dirname, "..", "vendor", "snoretoast", `snoretoast-${arch}.exe`);
    args = ["-t", title, "-m", message, "-appID", "Claude.Code"];
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
      const { execFileSync } = require("child_process");
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
