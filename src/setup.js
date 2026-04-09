const fs = require("fs");
const path = require("path");
const os = require("os");

const PKG_NAME = "claude-hook-notify";

// ANSI colors
const c = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
};

/**
 * 生成 hooks 配置
 */
function generateHooksConfig(events) {
  const hooks = {};
  for (const event of events) {
    hooks[event] = [
      {
        matcher: "",
        hooks: [
          {
            type: "command",
            command: `npx --yes ${PKG_NAME}@latest notify --event ${event}`,
            timeout: 10,
          },
        ],
      },
    ];
  }
  return hooks;
}

/**
 * 获取配置文件路径
 */
function getSettingsPath(scope) {
  if (scope === "local") {
    return path.join(process.cwd(), ".claude", "settings.json");
  }
  return path.join(os.homedir(), ".claude", "settings.json");
}

/**
 * 安全读取 JSON 文件
 */
function readJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch {
    // 文件损坏或不可读
  }
  return {};
}

/**
 * 安全写入 JSON 文件
 */
function writeJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * 检查平台依赖
 */
function checkDependencies() {
  const platform = os.platform();
  const warnings = [];

  if (platform === "linux") {
    try {
      require("child_process").execSync("command -v notify-send", {
        stdio: "ignore",
      });
    } catch {
      warnings.push(
        `${c.yellow("⚠")}  未检测到 notify-send，请安装：${c.cyan("sudo apt-get install libnotify-bin")}`
      );
    }
  }

  if (platform === "darwin") {
    try {
      require("child_process").execSync("command -v terminal-notifier", {
        stdio: "ignore",
      });
      console.log(
        `${c.green("✓")}  检测到 terminal-notifier（增强通知体验）`
      );
    } catch {
      console.log(
        `${c.dim("ℹ")}  可选：${c.cyan("brew install terminal-notifier")} 获得更好的通知体验`
      );
    }
  }

  return warnings;
}

/**
 * 安装 hooks 配置
 */
async function setup({ scope = "global", events = ["Stop", "TaskCompleted", "Notification"] }) {
  const settingsPath = getSettingsPath(scope);
  const scopeLabel = scope === "global" ? "全局" : "项目";

  console.log();
  console.log(
    `  ${c.bold("🔔 Claude Code Notify — 安装向导")}`
  );
  console.log();

  // 检查依赖
  const warnings = checkDependencies();
  warnings.forEach((w) => console.log(`  ${w}`));

  // 读取现有配置
  const settings = readJSON(settingsPath);
  const existingHooks = settings.hooks || {};

  // 检查是否已安装
  const alreadyInstalled = events.some(
    (event) =>
      existingHooks[event]?.some((h) =>
        h.hooks?.some((hh) => hh.command?.includes(PKG_NAME))
      )
  );

  if (alreadyInstalled) {
    console.log(
      `  ${c.yellow("⚠")}  检测到已有 ${PKG_NAME} 的 hook 配置`
    );
    console.log(`  ${c.dim("   将会覆盖现有的通知 hook 配置")}`);
    console.log();
  }

  // 生成新的 hooks 配置
  const newHooks = generateHooksConfig(events);

  // 合并配置（只覆盖 claude-hook-notify 相关的 hook，保留其他 hook）
  for (const [event, hookConfigs] of Object.entries(newHooks)) {
    if (existingHooks[event]) {
      // 移除旧的 claude-hook-notify hook，保留其他
      existingHooks[event] = existingHooks[event].filter(
        (h) => !h.hooks?.some((hh) => hh.command?.includes(PKG_NAME))
      );
      // 追加新的
      existingHooks[event].push(...hookConfigs);
    } else {
      existingHooks[event] = hookConfigs;
    }
  }

  settings.hooks = existingHooks;

  // 写入配置
  writeJSON(settingsPath, settings);

  // 输出结果
  console.log(
    `  ${c.green("✓")}  已写入${scopeLabel}配置: ${c.cyan(settingsPath)}`
  );
  console.log();
  console.log(`  ${c.bold("已注册的事件:")}`);
  for (const event of events) {
    const labels = {
      Stop: "Agent 完成响应时通知",
      TaskCompleted: "子任务完成时通知",
      Notification: "需要用户注意时通知",
      PostToolUseFailure: "工具执行失败时通知",
      SubagentStop: "子代理完成时通知",
      StopFailure: "API 错误导致中断时通知",
    };
    console.log(
      `     ${c.green("•")} ${c.bold(event)} — ${labels[event] || "自定义事件"}`
    );
  }
  console.log();
  console.log(
    `  ${c.dim("重启 Claude Code 后生效。")}`
  );
  console.log(
    `  ${c.dim(`卸载: npx ${PKG_NAME} uninstall${scope === "local" ? " --local" : ""}`)}`
  );
  console.log();
}

/**
 * 清理 npx 缓存中的 claude-hook-notify
 */
function cleanNpxCache() {
  let cacheDir;
  try {
    cacheDir = require("child_process")
      .execSync("npm config get cache", { encoding: "utf-8" })
      .trim();
  } catch {
    return 0;
  }

  const npxDir = path.join(cacheDir, "_npx");
  if (!fs.existsSync(npxDir)) return 0;

  let cleaned = 0;
  try {
    const entries = fs.readdirSync(npxDir);
    for (const entry of entries) {
      const pkgPath = path.join(npxDir, entry, "package.json");
      try {
        if (!fs.existsSync(pkgPath)) continue;
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.dependencies && pkg.dependencies[PKG_NAME]) {
          fs.rmSync(path.join(npxDir, entry), { recursive: true, force: true });
          cleaned++;
        }
      } catch {
        // 跳过无法读取的目录
      }
    }
  } catch {
    // 无法读取 npx 缓存目录
  }
  return cleaned;
}

/**
 * 卸载 hooks 配置
 */
async function uninstall({ scope = "global" }) {
  const settingsPath = getSettingsPath(scope);
  const scopeLabel = scope === "global" ? "全局" : "项目";

  console.log();
  console.log(`  ${c.bold("🔔 Claude Code Notify — 卸载")}`);
  console.log();

  // 清理 hooks 配置
  let removed = 0;

  if (fs.existsSync(settingsPath)) {
    const settings = readJSON(settingsPath);
    if (settings.hooks) {
      for (const [event, hookConfigs] of Object.entries(settings.hooks)) {
        const before = hookConfigs.length;
        settings.hooks[event] = hookConfigs.filter(
          (h) => !h.hooks?.some((hh) => hh.command?.includes(PKG_NAME))
        );
        removed += before - settings.hooks[event].length;

        // 清理空数组
        if (settings.hooks[event].length === 0) {
          delete settings.hooks[event];
        }
      }

      // 清理空 hooks 对象
      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }

      writeJSON(settingsPath, settings);
    }
  }

  if (removed > 0) {
    console.log(
      `  ${c.green("✓")}  已从${scopeLabel}配置中移除 ${removed} 个通知 hook`
    );
  } else {
    console.log(
      `  ${c.yellow("ℹ")}  未找到 ${PKG_NAME} 相关的 hook 配置`
    );
  }
  console.log(
    `  ${c.dim("配置文件: " + settingsPath)}`
  );

  // 清理 npx 缓存
  const cleaned = cleanNpxCache();
  if (cleaned > 0) {
    console.log(
      `  ${c.green("✓")}  已清理 ${cleaned} 个 npx 缓存目录`
    );
  }

  console.log();
}

module.exports = { setup, uninstall };
