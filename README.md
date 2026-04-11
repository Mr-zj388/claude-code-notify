# 🔔 claude-hook-notify

Claude Code 任务完成桌面通知 — 一键安装，跨平台支持 (macOS / Linux / Windows)

> 不用再盯着终端等 Claude Code 完成了。任务一完，桌面通知自动弹出。

## 快速开始

```bash
npx claude-hook-notify setup
```

就这一行。重启 Claude Code 后即可生效。

## 效果

当 Claude Code 完成任务时，你会收到系统原生桌面通知，并显示**本次任务的 token 消耗**：

```
┌─────────────────────────────────────────────────────┐
│  Claude Code · 本次任务消耗 1.2k tokens            │  ← 顶部栏（Windows）
│  🔔 Claude Code 完成 (my-project)                  │
│  已完成代码重构和测试                                │
└─────────────────────────────────────────────────────┘
```

含子代理调用的任务会额外显示子代理次数：

```
Claude Code · 本次任务消耗 42k tokens · 子代理 7
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

# 锁定到指定版本（不自动更新）
npx claude-hook-notify setup --pin 1.5.0
```

> **版本自动更新**：默认情况下 hook 使用 `claude-hook-notify@latest`，每次触发都会拉取最新版本。如果你希望锁定到某个稳定版本不跟随更新，使用 `--pin <版本号>`。锁定后，要升级必须重新运行 setup。

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

## Token 消耗统计

在 `Stop` / `SubagentStop` / `StopFailure` 事件触发时，通知会显示**本次任务新增到对话上下文的 token 量**（而不是整个 session 的累计，也不是 API 账单总额）。

### 计算口径：context-delta

```
本次任务消耗 = (回合结束时上下文大小) − (回合开始前上下文大小) + sum(本回合 output_tokens)
```

- **"上下文大小"** = 单次 API 调用的 `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
- **"回合"** = 从最后一条真实用户消息到 Stop 事件之间
- **子代理**：通过主 transcript 的 `progress` 条目镜像统计，按 `message.id` 去重（progress 会重复触发同一 id 5~8 次）

### 为什么不直接累加 `cache_creation_input_tokens`

缓存失效（默认 5 分钟 TTL）时 Claude 会把整段对话历史重新写入缓存槽位，导致单次调用的 `cache_creation_input_tokens` 飙升到历史总量规模。直接累加会把这些"本来就在对话里"的 tokens 误算作新增消耗，出现数倍虚高（开发过程中曾经见过 146k 的虚高值）。

用 context-delta 算法规避了这个陷阱：`input + cache_creation + cache_read` 的总和表示"当前 prompt 的总上下文大小"，这个值随对话进展单调递增，不受缓存重建影响。

### 准确率：~92–96%

| 场景 | 准确率 | 说明 |
|------|--------|------|
| 纯主代理的普通回合（读文件、编辑、Bash 等） | **~96%** | 主要误差为缓存边界的 ±100 tokens 级测量波动 |
| 含子代理的回合 | **~85–92%** | 子代理最终结果文本会被同时计入子代理 output 与主 context delta，造成轻微双重计数 |
| 新 session 第一次交互 | **~70%** | `prevContext=0`，system prompt（约 5k）会被算作本次新增 |
| 触发了 `/compact` 或 auto-compact 的长回合 | 不确定 | 上下文被压缩，`currentContext < prevContext` 时归零，可能严重低估 |
| 包含 API 重试的回合 | **~96%** | 按 `message.id` 去重已足够 |

### 对比其他口径

| 问题 | 我们的算法 | ccusage session 口径 | Claude Code 原生 `/context` |
|------|-----------|---------------------|---------------------------|
| "这次任务新增了多少对话内容？" | ✅ | ❌ 是累计总和 | ❌ 是当前快照 |
| "整个 session 总 API 账单？" | ❌ 量级对但精度低 | ✅ | ❌ |
| "当前上下文窗口占用？" | ❌ | 部分支持 | ✅ |

如果你想要账单精度的成本统计，推荐使用 [ccusage](https://github.com/ryoppippi/ccusage)，它集成了 LiteLLM 价格表并正确按 API 账单口径累加。本工具的 token 显示定位是**让你感知单次任务的数量级**，不是账单。

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
- **Token 消耗精度**: 桌面通知显示的"本次任务消耗"是 context-delta 估算值，准确率 ~92-96%（详见上文 [Token 消耗统计](#token-消耗统计) 章节）。不适合作为账单依据。
- **Windows 动态 appID**: Windows 上 token 信息通过动态 `-appID` 显示在 Toast 顶部栏，每次数值变化会在系统"通知与操作"设置里登记一条新记录，属 SnoreToast 的已知副作用。

## License

MIT
