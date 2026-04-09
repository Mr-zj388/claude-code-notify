# 🔔 claude-hook-notify

Claude Code 任务完成桌面通知 — 一键安装，跨平台支持 (macOS / Linux / Windows)

> 不用再盯着终端等 Claude Code 完成了。任务一完，桌面通知自动弹出。

## 快速开始

```bash
npx claude-hook-notify setup
```

就这一行。重启 Claude Code 后即可生效。

## 效果

当 Claude Code 完成任务时，你会收到系统原生桌面通知：

```
┌──────────────────────────────────────┐
│  🔔 Claude Code 完成 (my-project)   │
│  已完成代码重构和测试                  │
└──────────────────────────────────────┘
```

API 错误中断时：

```
┌──────────────────────────────────────────────────┐
│  ⚠ Claude Code 错误: 请求频率限制 (my-project)    │
│  Rate limit exceeded: too many requests           │
└──────────────────────────────────────────────────┘
```

## 命令

### 安装

```bash
# 全局安装（所有项目生效，默认）
npx claude-hook-notify setup

# 仅当前项目
npx claude-hook-notify setup --local

# 指定监听事件
npx claude-hook-notify setup --events Stop,TaskCompleted
```

### 卸载

```bash
npx claude-hook-notify uninstall

# 卸载项目级配置
npx claude-hook-notify uninstall --local
```

### 手动发送通知（测试用）

```bash
# 测试通知
npx claude-hook-notify notify --event Stop --dry-run

# 自定义通知
npx claude-hook-notify notify --title "构建完成" --message "所有测试通过"
```

## 监听事件

| 事件              | 触发时机                         | 音效 (macOS) |
| ----------------- | -------------------------------- | ------------ |
| `Stop`            | Claude Code 完成一次响应         | Glass        |
| `TaskCompleted`   | 子任务被标记为完成               | Hero         |
| `Notification`    | Claude Code 需要你注意（等输入） | Ping         |

> **注意**: `Stop` 事件在响应因 token 限制被截断时会显示特殊提示。

也可以添加额外事件（注意：`StopFailure` 不是 Claude Code 官方支持的 hook 事件，使用会导致配置报错）：

```bash
npx claude-hook-notify setup --events Stop,TaskCompleted,Notification,PostToolUseFailure,SubagentStop
```

## 平台支持

| 平台    | 通知方式             | 依赖                                          |
| ------- | -------------------- | --------------------------------------------- |
| macOS   | `osascript`          | 无（系统自带）                                |
| macOS   | `terminal-notifier`  | 可选: `brew install terminal-notifier`（更好） |
| Linux   | `notify-send`        | `sudo apt-get install libnotify-bin`          |
| Windows | Toast 通知 (PowerShell) | 无（Windows 10+ 系统自带）                 |

## 原理

安装时会在 `~/.claude/settings.json` 中添加 hooks 配置。当对应事件触发时，Claude Code 会自动执行 `npx claude-hook-notify notify --event <事件名>`，脚本会读取 hook 传入的上下文信息（任务名称、最后的 assistant 消息等），然后通过系统原生 API 发送桌面通知。

## 编程接口

也可以作为库使用：

```js
const { sendNotification } = require("claude-hook-notify");

await sendNotification({
  event: "Stop",
  title: "构建完成",
  message: "所有 42 个测试通过",
});
```

## 已知限制

- **Ctrl+C 用户中断**: 用户手动按 Ctrl+C 取消时不会触发任何 hook 事件，因此无法发送通知。
- **网络完全断开**: 如果网络完全断开导致 Claude Code 进程本身退出，hook 可能无法执行。
- **StopFailure 事件**: `StopFailure` 不是 Claude Code 官方支持的 hook 事件名，默认不再注册。如通过 `--events` 手动指定，会导致 settings.json 校验报错，整个配置文件被跳过。

## License

MIT
