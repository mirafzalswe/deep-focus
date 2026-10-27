# Проверки настоящего окна Windows для e2e (P/Invoke user32): расширенные стили окна по HWND,
# фокус на постороннем окне и нажатие глобальной горячей клавиши.
#
#   win32.ps1 -Hwnd <hwnd>                       → JSON со стилями окна
#   win32.ps1 -Hwnd <hwnd> -Foreign              → открыть Блокнот, отдать ему фокус, затем стили окна
#   win32.ps1 -Keys "ctrl+alt+i" -TargetPid <pid> -Hwnd <hwnd>
#       → нажать сочетание (keybd_event). Если синтетический ввод не доходит до рабочего стола
#         (экран заблокирован: нет окна переднего плана, работает LogonUI), то:
#         1) доказать, что сочетание действительно занято в системе: RegisterHotKey из этого процесса
#            получает ERROR_HOTKEY_ALREADY_REGISTERED (1409);
#         2) доставить WM_HOTKEY окнам процесса pid так, как это делает Windows при нажатии: по одному
#            идентификатору регистрации, пока не изменится состояние окна hwnd (стили или видимость).
param(
  [Int64]$Hwnd = 0,
  [switch]$Foreign,
  [string]$Keys = '',
  [int]$TargetPid = 0
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
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
  [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint uCode, uint uMapType);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll", SetLastError = true)] public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);

  /// <summary>true, если окно a выше окна b в z-порядке.</summary>
  public static bool IsAbove(IntPtr a, IntPtr b) {
    for (IntPtr h = GetWindow(b, 3); h != IntPtr.Zero; h = GetWindow(h, 3)) { if (h == a) return true; }
    return false;
  }

  /// <summary>Окна процесса pid: верхнего уровня (включая скрытые служебные) и message-only.</summary>
  public static List<IntPtr> WindowsOf(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) list.Add(h); return true; }, IntPtr.Zero);
    IntPtr messageOnly = new IntPtr(-3);
    for (IntPtr h = FindWindowEx(messageOnly, IntPtr.Zero, null, null); h != IntPtr.Zero; h = FindWindowEx(messageOnly, h, null, null)) {
      uint p; GetWindowThreadProcessId(h, out p); if (p == pid) list.Add(h);
    }
    return list;
  }
}
"@

$GWL_EXSTYLE = -20
$WS_EX_TOPMOST = 0x8
$WS_EX_TRANSPARENT = 0x20
$WS_EX_TOOLWINDOW = 0x80
$WS_EX_LAYERED = 0x80000
$WS_EX_NOACTIVATE = 0x8000000
$WM_HOTKEY = 0x0312
$ERROR_HOTKEY_ALREADY_REGISTERED = 1409

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

# Сочетание → коды клавиш (для keybd_event) и модификаторы WM_HOTKEY/RegisterHotKey (MOD_ALT 1, MOD_CONTROL 2, MOD_SHIFT 4)
function Get-Combo([string]$combo) {
  $vk = @{ ctrl = 0x11; alt = 0x12; shift = 0x10; space = 0x20 }
  $modBits = @{ ctrl = 2; alt = 1; shift = 4 }
  $codes = @(); $mods = 0; $key = 0
  foreach ($part in $combo.ToLower().Split('+')) {
    if ($vk.ContainsKey($part)) { $code = $vk[$part] } else { $code = [int][char]$part.ToUpper() }
    $codes += [byte]$code
    if ($modBits.ContainsKey($part)) { $mods = $mods -bor $modBits[$part] } else { $key = $code }
  }
  return @{ codes = $codes; mods = $mods; key = $key }
}

# Доходит ли синтетический ввод до рабочего стола пользователя (на экране блокировки — нет)
function Test-InputReachable {
  if ([DfWin32]::GetForegroundWindow() -eq [IntPtr]::Zero) { return $false }
  [DfWin32]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 30
  $down = ([DfWin32]::GetAsyncKeyState(0x10) -band 0x8000) -ne 0
  [DfWin32]::keybd_event(0x10, 0, 0x2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 30
  return $down
}

function Send-Keys($combo) {
  $codes = @($combo.codes)
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

# Сочетание зарегистрировано кем-то в системе: наша попытка RegisterHotKey отклонена с кодом 1409
function Test-HotkeyTaken($combo) {
  $ok = [DfWin32]::RegisterHotKey([IntPtr]::Zero, 0x7A11, [uint32]$combo.mods, [uint32]$combo.key)
  $err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
  if ($ok) { [void][DfWin32]::UnregisterHotKey([IntPtr]::Zero, 0x7A11); return $false }
  return ($err -eq $ERROR_HOTKEY_ALREADY_REGISTERED)
}

# WM_HOTKEY окнам процесса — как при настоящем нажатии. wParam — идентификатор регистрации (Chromium
# принимает сообщение только от своего id), lParam — модификаторы и клавиша. Перебираем id по одному,
# пока не изменится состояние окна hwnd, — так действие срабатывает ровно один раз.
function Send-HotkeyMessage($combo, [int]$procId, [IntPtr]$watch) {
  $targets = [DfWin32]::WindowsOf([uint32]$procId)
  $lParam = [IntPtr](($combo.key -shl 16) -bor $combo.mods)
  $before = Get-Styles $watch
  for ($id = 0; $id -lt 64; $id++) {
    foreach ($h in $targets) { [void][DfWin32]::PostMessage($h, $WM_HOTKEY, [IntPtr]$id, $lParam) }
    Start-Sleep -Milliseconds 150
    $now = Get-Styles $watch
    if ($now.exStyle -ne $before.exStyle -or $now.visible -ne $before.visible) { return $true }
  }
  return $false
}

$result = [ordered]@{}

if ($Keys) {
  $combo = Get-Combo $Keys
  $result.keys = $Keys
  $result.inputReachable = Test-InputReachable
  if ($result.inputReachable) {
    Send-Keys $combo
    $result.via = 'input'
  } else {
    $result.lockScreen = [bool](Get-Process LogonUI -ErrorAction SilentlyContinue)
    $result.hotkeyTaken = Test-HotkeyTaken $combo
    $result.via = 'wm_hotkey'
    if ($TargetPid -ne 0 -and $Hwnd -ne 0) { $result.delivered = Send-HotkeyMessage $combo $TargetPid ([IntPtr]$Hwnd) }
  }
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
} elseif ($Hwnd -ne 0 -and -not $Keys) {
  $result.window = Get-Styles ([IntPtr]$Hwnd)
}

$result | ConvertTo-Json -Compress -Depth 4
