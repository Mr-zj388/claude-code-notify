const { execSync, execFileSync } = require("child_process");
const os = require("os");

/**
 * 终端进程名到 macOS bundleId 的映射
 */
const MAC_BUNDLE_MAP = {
  "Terminal": "com.apple.Terminal",
  "iTerm2": "com.googlecode.iterm2",
  "iTerm2-v3": "com.googlecode.iterm2",
  "Electron": null, // 需进一步判断
  "Code": "com.microsoft.VSCode",
  "Code - Insiders": "com.microsoft.VSCodeInsiders",
  "Cursor": "com.todesktop.230313mzl4w4u92",
  "WarpTerminal": "dev.warp.Warp-Stable",
  "Alacritty": "org.alacritty",
  "kitty": "net.kovidgoyal.kitty",
  "Hyper": "co.zeit.hyper",
  "Tabby": "org.tabby",
};

/**
 * Windows 终端进程名（小写，不含 .exe）
 */
const WIN_TERMINAL_NAMES = new Set([
  "windowsterminal",
  "code",
  "cursor",
  "claude",
  "cmd",
  "powershell",
  "pwsh",
  "mintty",
  "alacritty",
  "wezterm-gui",
  "hyper",
  "tabby",
  "conhost",
]);

/**
 * Linux 终端进程名
 */
const LINUX_TERMINALS = new Set([
  "gnome-terminal-server",
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "mate-terminal",
  "tilix",
  "terminator",
  "alacritty",
  "kitty",
  "wezterm-gui",
  "foot",
  "code",
  "cursor",
  "hyper",
  "tabby",
]);

/**
 * 沿进程树向上查找终端进程
 */
function detectTerminal() {
  const platform = os.platform();
  try {
    if (platform === "darwin") return detectMac();
    if (platform === "win32") return detectWindows();
    if (platform === "linux") return detectLinux();
  } catch {
    // 检测失败
  }
  return null;
}

function detectMac() {
  let pid = process.ppid;
  for (let i = 0; i < 20 && pid > 1; i++) {
    try {
      const info = execSync(`ps -o ppid=,comm= -p ${pid}`, { encoding: "utf-8" }).trim();
      const match = info.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) break;
      const ppid = parseInt(match[1], 10);
      const comm = match[2].trim().split("/").pop();

      if (MAC_BUNDLE_MAP[comm] !== undefined) {
        const bundleId = MAC_BUNDLE_MAP[comm];
        if (bundleId) {
          return { name: comm, bundleId, pid, processName: comm };
        }
      }
      pid = ppid;
    } catch {
      break;
    }
  }
  // 回退：检查 TERM_PROGRAM 环境变量
  const termProgram = process.env.TERM_PROGRAM;
  if (termProgram) {
    const map = {
      "Apple_Terminal": { name: "Terminal", bundleId: "com.apple.Terminal" },
      "iTerm.app": { name: "iTerm2", bundleId: "com.googlecode.iterm2" },
      "vscode": { name: "Code", bundleId: "com.microsoft.VSCode" },
      "WarpTerminal": { name: "Warp", bundleId: "dev.warp.Warp-Stable" },
      "Hyper": { name: "Hyper", bundleId: "co.zeit.hyper" },
    };
    if (map[termProgram]) {
      return { ...map[termProgram], pid: 0, processName: termProgram };
    }
  }
  return null;
}

/**
 * Windows: 优先环境变量，回退单次 PowerShell 批量查询
 */
function detectWindows() {
  // 1. 环境变量快速检测（仅保留精确 PID 的路径）
  if (process.env.VSCODE_PID) {
    const pid = parseInt(process.env.VSCODE_PID, 10);
    if (pid > 0) return { name: "Code", pid, processName: "code.exe" };
  }

  // 2. WMI 遍历进程树（OS 级 ParentProcessId 始终完整，不受 spawn 方式影响）
  try {
    const script = [
      "$cpid=" + process.pid,
      "for($i=0;$i -lt 30 -and $cpid -gt 0;$i++){",
      "  $w=Get-CimInstance Win32_Process -Filter \"ProcessId=$cpid\" -EA SilentlyContinue",
      "  if(-not $w){break}",
      "  Write-Output \"$($w.Name)|$($w.ProcessId)|$($w.ParentProcessId)\"",
      "  $cpid=$w.ParentProcessId",
      "}",
    ].join(";");
    const output = execFileSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf-8",
      timeout: 8000,
    }).trim();

    // 遍历整棵进程树，取最高层级（最靠近根）的终端匹配
    // 避免误取 powershell/cmd 等 shell 进程 —— 它们在 Windows Terminal 下不拥有窗口
    let bestMatch = null;
    for (const line of output.split("\n")) {
      const parts = line.trim().split("|");
      if (parts.length < 3) continue;
      // WMI 返回的 Name 带 .exe 后缀，去掉再匹配
      const name = parts[0].replace(/\.exe$/i, "").toLowerCase();
      const pid = parseInt(parts[1], 10);
      if (WIN_TERMINAL_NAMES.has(name)) {
        bestMatch = { name: parts[0].replace(/\.exe$/i, ""), pid, processName: parts[0] };
      }
    }
    return bestMatch;
  } catch {
    // PowerShell 调用失败
  }
  return null;
}

function detectLinux() {
  // 1. 环境变量快速检测
  if (process.env.VSCODE_PID) {
    const pid = parseInt(process.env.VSCODE_PID, 10);
    if (pid > 0) return { name: "code", pid, processName: "code" };
  }

  // 2. 进程树遍历
  let pid = process.ppid;
  for (let i = 0; i < 20 && pid > 1; i++) {
    try {
      const info = execSync(`ps -o ppid=,comm= -p ${pid}`, { encoding: "utf-8" }).trim();
      const match = info.match(/^\s*(\d+)\s+(.+)$/);
      if (!match) break;
      const ppid = parseInt(match[1], 10);
      const comm = match[2].trim();

      if (LINUX_TERMINALS.has(comm)) {
        return { name: comm, pid, processName: comm };
      }
      pid = ppid;
    } catch {
      break;
    }
  }
  return null;
}

/**
 * 获取激活终端窗口的命令和参数
 */
function getActivateCommand(terminalInfo) {
  if (!terminalInfo) return null;
  const platform = os.platform();

  if (platform === "darwin") {
    if (terminalInfo.bundleId) {
      return {
        command: "osascript",
        args: ["-e", `tell application id "${terminalInfo.bundleId}" to activate`],
      };
    }
    return null;
  }

  // Windows 使用 notify-helper.exe 自行处理激活，不需要此函数

  if (platform === "linux") {
    return {
      command: "xdotool",
      args: ["search", "--pid", String(terminalInfo.pid), "--onlyvisible", "windowactivate"],
      fallbackCommand: "wmctrl",
      fallbackArgs: ["-ia", String(terminalInfo.pid)],
    };
  }

  return null;
}

module.exports = { detectTerminal, getActivateCommand };
