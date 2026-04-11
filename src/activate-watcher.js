#!/usr/bin/env node

/**
 * 后台点击监听脚本
 *
 * 由主进程 spawn 为 detached 后台进程。
 * 执行通知命令（带等待标志），检测用户点击后激活终端窗口。
 *
 * 参数格式:
 *   node activate-watcher.js <JSON配置>
 *
 * JSON 配置:
 *   {
 *     "platform": "win32" | "linux",
 *     "notifyCommand": "...",
 *     "notifyArgs": ["..."],
 *     "activateCommand": "...",
 *     "activateArgs": ["..."],
 *     "activateFallbackCommand": "...",   // 可选
 *     "activateFallbackArgs": ["..."],    // 可选
 *     "timeout": 120000
 *   }
 */

const { spawn, execFileSync } = require("child_process");

// 120 秒超时自动退出，防僵尸进程
const config = parseConfig();
const selfTimeout = setTimeout(() => process.exit(0), config.timeout || 120000);
selfTimeout.unref();

function parseConfig() {
  try {
    return JSON.parse(process.argv[2] || "{}");
  } catch {
    process.exit(1);
  }
}

function activateTerminal() {
  const { activateCommand, activateArgs, activateFallbackCommand, activateFallbackArgs } = config;
  if (!activateCommand) return;

  try {
    execFileSync(activateCommand, activateArgs || [], { stdio: "ignore", timeout: 5000 });
  } catch {
    // 主命令失败，尝试回退
    if (activateFallbackCommand) {
      try {
        execFileSync(activateFallbackCommand, activateFallbackArgs || [], { stdio: "ignore", timeout: 5000 });
      } catch {
        // 回退也失败，静默退出
      }
    }
  }
}

async function main() {
  const { platform, notifyCommand, notifyArgs } = config;
  if (!notifyCommand) process.exit(1);

  if (platform === "linux") {
    // notify-send --action 模式：stdout 输出 action 名
    const child = spawn(notifyCommand, notifyArgs, {
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 120000,
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("close", () => {
      if (output.trim() === "default") {
        activateTerminal();
      }
    });
  }
}

main().catch(() => process.exit(1));
