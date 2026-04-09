using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Claude Code 完成通知")]
[assembly: System.Reflection.AssemblyProduct("Claude Code Notify")]

class NotifyHelper
{
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll")]
    static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();

    // 已知 GUI 终端的窗口类名（用于 PID 查找失败时的回退）
    static string[] KnownWindowClasses = new string[] {
        "CASCADIA_HOSTING_WINDOW_CLASS",  // Windows Terminal
        "mintty",                          // Git Bash / mintty
    };

    // Claude sparkle 图标 PNG（内嵌，无需外部文件）
    static string IconBase64 = "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";

    static IntPtr targetHandle = IntPtr.Zero;
    static NotifyIcon notify;

    static void Main(string[] args)
    {
        string title = args.Length > 0 ? args[0] : "Claude Code";
        string message = args.Length > 1 ? args[1] : "任务完成";
        string targetName = args.Length > 2 ? args[2] : "";
        int targetPid = 0;
        if (args.Length > 3) int.TryParse(args[3], out targetPid);

        // 策略 1：通过 PID 精确定位终端窗口（多实例场景）
        if (targetPid > 0)
        {
            try
            {
                using (var proc = Process.GetProcessById(targetPid))
                {
                    if (proc.MainWindowHandle != IntPtr.Zero)
                    {
                        targetHandle = proc.MainWindowHandle;
                    }
                    else
                    {
                        // MainWindowHandle 可能为零（如 Windows Terminal），用 EnumWindows 查找
                        targetHandle = FindWindowByPid(targetPid);
                    }
                }
            }
            catch { /* 进程可能已退出，回退到名称查找 */ }
        }

        // 策略 2：通过进程名查找（回退方案）
        if (targetHandle == IntPtr.Zero && !string.IsNullOrEmpty(targetName))
        {
            foreach (var name in targetName.Split(','))
            {
                try
                {
                    var procs = Process.GetProcessesByName(name.Trim());
                    try
                    {
                        foreach (var p in procs)
                        {
                            if (p.MainWindowHandle != IntPtr.Zero)
                            {
                                targetHandle = p.MainWindowHandle;
                                break;
                            }
                            // MainWindowHandle 为零时尝试 EnumWindows 查找
                            IntPtr hwnd = FindWindowByPid(p.Id);
                            if (hwnd != IntPtr.Zero)
                            {
                                targetHandle = hwnd;
                                break;
                            }
                        }
                    }
                    finally
                    {
                        foreach (var p in procs) p.Dispose();
                    }
                    if (targetHandle != IntPtr.Zero) break;
                }
                catch { }
            }
        }

        // 策略 3：通过已知窗口类名查找（兜底方案）
        if (targetHandle == IntPtr.Zero)
        {
            foreach (var cls in KnownWindowClasses)
            {
                IntPtr hwnd = FindWindow(cls, null);
                if (hwnd != IntPtr.Zero)
                {
                    targetHandle = hwnd;
                    break;
                }
            }
        }

        notify = new NotifyIcon();
        notify.Icon = LoadEmbeddedIcon();
        notify.Visible = true;
        notify.BalloonTipTitle = title;
        notify.BalloonTipText = message;
        notify.BalloonTipIcon = ToolTipIcon.None;

        notify.BalloonTipClicked += delegate { ActivateAndExit(); };
        notify.Click += delegate { ActivateAndExit(); };
        notify.BalloonTipClosed += delegate { Cleanup(); };

        notify.ShowBalloonTip(15000);

        var timer = new Timer();
        timer.Interval = 60000;
        timer.Tick += delegate { Cleanup(); };
        timer.Start();

        Application.Run();
    }

    static IntPtr FindWindowByPid(int pid)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) =>
        {
            uint procId;
            GetWindowThreadProcessId(hWnd, out procId);
            if ((int)procId == pid && IsWindowVisible(hWnd))
            {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    static Icon LoadEmbeddedIcon()
    {
        try
        {
            var bytes = Convert.FromBase64String(IconBase64);
            using (var ms = new MemoryStream(bytes))
            {
                var bmp = new Bitmap(ms);
                var resized = new Bitmap(bmp, 32, 32);
                return Icon.FromHandle(resized.GetHicon());
            }
        }
        catch
        {
            return SystemIcons.Information;
        }
    }

    static void ActivateAndExit()
    {
        if (targetHandle != IntPtr.Zero)
        {
            ShowWindow(targetHandle, 9); // SW_RESTORE
            // 使用 AttachThreadInput 确保 SetForegroundWindow 成功
            // （Windows 限制后台进程直接抢占前台焦点）
            uint unusedPid;
            uint targetThread = GetWindowThreadProcessId(targetHandle, out unusedPid);
            uint curThread = GetCurrentThreadId();
            if (curThread != targetThread)
            {
                AttachThreadInput(curThread, targetThread, true);
                SetForegroundWindow(targetHandle);
                AttachThreadInput(curThread, targetThread, false);
            }
            else
            {
                SetForegroundWindow(targetHandle);
            }
        }
        Cleanup();
    }

    static void Cleanup()
    {
        if (notify != null)
        {
            notify.Visible = false;
            notify.Dispose();
        }
        Application.ExitThread();
    }
}
