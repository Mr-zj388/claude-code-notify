#!/usr/bin/env node

const { setup } = require("./setup");
const { uninstall } = require("./setup");
const { sendNotification } = require("./notify");

const HELP = `
  claude-hook-notify — 🔔 Claude Code 任务完成桌面通知

  用法:
    claude-hook-notify setup       一键安装 hooks 配置
    claude-hook-notify uninstall   移除已安装的 hooks 配置
    claude-hook-notify notify      发送通知（由 hook 自动调用）
    claude-hook-notify help        显示帮助信息

  setup 选项:
    --global                 安装到全局配置 ~/.claude/settings.json（默认）
    --local                  安装到当前项目 .claude/settings.json
    --events <事件列表>      要监听的事件，逗号分隔
                             默认: Stop,TaskCompleted,Notification

  notify 选项:
    --event <事件名>         事件类型 (Stop/TaskCompleted/Notification/...)
    --title <标题>           自定义通知标题
    --message <消息>         自定义通知消息
    --sound <音效>           macOS 音效名称 (默认: Glass)
    --dry-run                仅打印通知内容，不实际发送

  示例:
    npx claude-hook-notify setup
    npx claude-hook-notify setup --events Stop,TaskCompleted
    npx claude-hook-notify uninstall
`;

function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (
        key === "dry-run" ||
        key === "global" ||
        key === "local" ||
        key === "help"
      ) {
        parsed[key] = true;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        parsed[key] = args[++i];
      } else {
        parsed[key] = true;
      }
    } else {
      parsed._.push(args[i]);
    }
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || command === "help" || args.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (command === "setup") {
    const scope = args.local ? "local" : "global";
    const events = args.events
      ? args.events.split(",").map((e) => e.trim())
      : ["Stop", "TaskCompleted", "Notification"];
    await setup({ scope, events });
    return;
  }

  if (command === "uninstall") {
    const scope = args.local ? "local" : "global";
    await uninstall({ scope });
    return;
  }

  if (command === "notify") {
    let input = {};
    // 从 stdin 读取 hook JSON 数据（非交互模式）
    if (!process.stdin.isTTY) {
      try {
        const chunks = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString("utf-8").trim();
        if (raw) input = JSON.parse(raw);
      } catch {
        // stdin 为空或非 JSON，忽略
      }
    }

    await sendNotification({
      event: args.event || "Stop",
      title: args.title,
      message: args.message,
      sound: args.sound,
      dryRun: !!args["dry-run"],
      hookInput: input,
    });
    return;
  }

  console.error(`未知命令: ${command}\n运行 claude-hook-notify help 查看帮助`);
  process.exit(1);
}

main().catch((err) => {
  console.error("错误:", err.message);
  process.exit(1);
});
