# CLAUDE.md

本文件为 Claude Code 在此仓库中工作时提供指导。

## 项目概述

Claude Code 桌面通知工具 — 通过 hooks 机制，在 Claude Code 完成任务、遇到错误等事件时发送系统原生桌面通知。

## 快速参考

- **源码目录**: `src/`
- **入口文件**: `src/index.js`
- **CLI 入口**: `src/cli.js`（bin: `claude-hook-notify`）
- **AI 导航文档**: `docs/ai-nav/`
- **Windows 通知工具**: `vendor/snoretoast/`（SnoreToast 原生 Toast 通知）

## 命令

```bash
node src/cli.js notify --event Stop --dry-run   # 测试通知（dry-run）
npx claude-hook-notify setup                     # 安装 hooks 配置
npx claude-hook-notify uninstall                 # 卸载 hooks 配置
```

## 禁止事项

- 禁止在 `sendNotification` 中使用 `execSync` 执行用户可控的字符串拼接命令 — 已使用 `execFileSync` + 参数数组防止命令注入
- 禁止在合并 hooks 配置时覆盖用户已有的非本工具 hook — 必须仅替换包含 `claude-hook-notify` 的条目
- 禁止硬编码平台检测结果 — 必须通过 `os.platform()` 动态判断

## 代码规范

- 所有用户可见文本使用中文
- CLI 参数解析使用自实现的 `parseArgs`，不依赖第三方库
- 每个平台的通知实现在 `sendNotification` 中通过 `if/else if` 分支处理
- 配置读写使用 `readJSON`/`writeJSON` 工具函数，带容错处理

## 架构

单体 Node.js CLI 工具，零运行时依赖。`cli.js` 解析命令行参数并分发到 `setup.js`（配置管理）或 `notify.js`（通知发送）。通知通过各平台原生命令发送：macOS 用 osascript/terminal-notifier，Linux 用 notify-send，Windows 用 SnoreToast（原生 Toast 通知）。`activate.js` 负责检测终端类型（macOS/Linux 支持通知点击后激活终端窗口，Windows 仅弹出通知）。

修改代码前，请先阅读 `docs/ai-nav/` 中对应的导航文档。

## 模块路由

| 模块 | 路径 | 职责 |
|------|------|------|
| 入口 | `src/index.js` | 导出公共 API |
| CLI | `src/cli.js` | 命令行解析与分发 |
| 通知 | `src/notify.js` | 跨平台通知发送、事件配置、上下文提取 |
| 配置 | `src/setup.js` | hooks 配置的安装与卸载 |
| 终端检测 | `src/activate.js` | 终端类型检测与窗口激活命令生成 |
| 点击监听 | `src/activate-watcher.js` | 后台脚本，监听通知点击后激活终端（Linux） |

## 注意事项

- `StopFailure` 不是 Claude Code 官方支持的 hook 事件，默认不注册
- Windows 使用 `vendor/snoretoast/` 下的 SnoreToast 发送原生 Toast 通知，仅支持弹窗显示，不支持点击后激活终端窗口（ConPTY 机制限制）
- hook 输入通过 stdin 以 JSON 格式传入，在非 TTY 模式下读取
