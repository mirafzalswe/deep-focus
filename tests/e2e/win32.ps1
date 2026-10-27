# Проверки настоящего окна Windows для e2e (P/Invoke user32): расширенные стили окна по HWND,
# фокус на постороннем окне и нажатие глобальной горячей клавиши.
#
#   win32.ps1 -Hwnd <hwnd>                       → JSON со стилями окна
#   win32.ps1 -Hwnd <hwnd> -Foreign              → открыть Блокнот, отдать ему фокус, затем стили окна
#   win32.ps1 -Keys "ctrl+alt+i"                 → нажать сочетание (SendInput/keybd_event)
param(
  [Int64]$Hwnd = 0,
  [switch]$Foreign,
  [string]$Keys = ''
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DfWin32 {
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  /// <summary>true, если окно a выше окна b в z-порядке.</summary>
  public static bool IsAbove(IntPtr a, IntPtr b) {
    for (IntPtr h = GetWindow(b, 3); h != IntPtr.Zero; h = GetWindow(h, 3)) { if (h == a) return true; }
    return false;
  }
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@

$GWL_EXSTYLE = -20
$WS_EX_TOPMOST = 0x8
$WS_EX_TRANSPARENT = 0x20
$WS_EX_TOOLWINDOW = 0x80
$WS_EX_LAYERED = 0x80000
$WS_EX_NOACTIVATE = 0x8000000

function Get-Styles([IntPtr]$h) {
  $ex = [DfWin32]::GetWindowLongPtr($h, $GWL_EXSTYLE).ToInt64()
  return [ordered]@{
    exists      = [DfWin32]::IsWindow($h)
    visible     = [DfWin32]::IsWindowVisible($h)
    exStyle     = $ex
    topmost     = (($ex -band $WS_EX_TOPMOST) -ne 0)
    transparent = (($ex -band $WS_EX_TRANSPARENT) -ne 0)
    layered     = (($ex -band $WS_EX_LAYERED) -ne 0)
    noActivate  = (($ex -band $WS_EX_NOACTIVATE) -ne 0)
    toolWindow  = (($ex -band $WS_EX_TOOLWINDOW) -ne 0)
  }
}

function Send-Keys([string]$combo) {
  $vk = @{ ctrl = 0x11; alt = 0x12; shift = 0x10; space = 0x20 }
  $codes = foreach ($part in $combo.ToLower().Split('+')) {
    if ($vk.ContainsKey($part)) { [byte]$vk[$part] } else { [byte][char]$part.ToUpper() }
  }
  $KEYUP = 0x2
  foreach ($c in $codes) {
    [DfWin32]::keybd_event($c, [byte][DfWin32]::MapVirtualKey($c, 0), 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 30
  }
  Start-Sleep -Milliseconds 80
  [array]::Reverse($codes)
  foreach ($c in $codes) {
    [DfWin32]::keybd_event($c, [byte][DfWin32]::MapVirtualKey($c, 0), $KEYUP, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 30
  }
  Start-Sleep -Milliseconds 150
}

$result = [ordered]@{}

if ($Keys) {
  Send-Keys $Keys
  $result.keys = $Keys
}

if ($Foreign) {
  $proc = Start-Process -FilePath 'notepad.exe' -PassThru
  try {
    $deadline = (Get-Date).AddSeconds(10)
    while ($proc.MainWindowHandle -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 100
      $proc.Refresh()
    }
    $fh = $proc.MainWindowHandle
    # Windows разрешает SetForegroundWindow процессу, который получил последний ввод, — «нажимаем» Alt
    $deadline = (Get-Date).AddSeconds(5)
    do {
      [DfWin32]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
      [DfWin32]::keybd_event(0x12, 0, 0x2, [UIntPtr]::Zero)
      [void][DfWin32]::SetForegroundWindow($fh)
      [DfWin32]::SwitchToThisWindow($fh, $true)
      Start-Sleep -Milliseconds 300
    } while ([DfWin32]::GetForegroundWindow() -ne $fh -and (Get-Date) -lt $deadline)
    Start-Sleep -Milliseconds 400
    $result.foreignForeground = ([DfWin32]::GetForegroundWindow() -eq $fh)
    # Стили читаются, пока Блокнот на переднем плане
    if (-not $result.foreignForeground) { [void][DfWin32]::SetForegroundWindow($fh); Start-Sleep -Milliseconds 300 }
    $result.foreignForeground = ([DfWin32]::GetForegroundWindow() -eq $fh)
    $result.foreignWindow = ($fh -ne [IntPtr]::Zero)
    if ($Hwnd -ne 0) {
      $result.window = Get-Styles ([IntPtr]$Hwnd)
      # Виджет выше окна Блокнота в z-порядке — независимо от того, отдала ли Windows ему фокус
      $result.aboveForeign = [DfWin32]::IsAbove([IntPtr]$Hwnd, $fh)
    }
  } finally {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  }
} elseif ($Hwnd -ne 0) {
  $result.window = Get-Styles ([IntPtr]$Hwnd)
}

$result | ConvertTo-Json -Compress -Depth 4
