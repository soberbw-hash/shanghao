!macro customInstall
  StrCpy $0 "$INSTDIR\resources\build\shanghao-shortcut-v3.ico"

  ${if} ${FileExists} "$newDesktopLink"
    Delete "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$0" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endif}

  ${if} ${FileExists} "$newStartMenuLink"
    Delete "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$0" 0 "" "" "${APP_DESCRIPTION}"
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endif}

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro requestShangHaoQuit
  ${if} ${FileExists} "$INSTDIR\ShangHao.exe"
    nsExec::ExecToLog '"$INSTDIR\ShangHao.exe" --shanghao-quit-for-install'
    Pop $0
  ${endif}
!macroend

!macro killShangHaoProcessByName PROCESS_NAME
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "${PROCESS_NAME}" /T /F'
  Pop $0
!macroend

!macro killShangHaoProcessByInstallDir
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dir = '$INSTDIR'; Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$dir, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
!macroend

!macro shutdownShangHaoProcesses
  !insertmacro requestShangHaoQuit
  Sleep 900

  ; 老版本可能还不认识 --shanghao-quit-for-install，或被托盘/悬浮窗留在后台。
  ; 所以同时按进程名和安装目录兜底清理，避免覆盖安装时文件被锁。
  !insertmacro killShangHaoProcessByName "ShangHao.exe"
  !insertmacro killShangHaoProcessByName "上号.exe"
  !insertmacro killShangHaoProcessByName "PrivateVoice.exe"
  !insertmacro killShangHaoProcessByInstallDir
  Sleep 650
!macroend

; 覆盖 electron-builder 默认的运行中检测：不要立刻把“无法关闭”抛给用户。
!macro customCheckAppRunning
  DetailPrint "正在清理旧版上号后台进程..."
  !insertmacro shutdownShangHaoProcesses
  !insertmacro shutdownShangHaoProcesses
  !insertmacro shutdownShangHaoProcesses
!macroend

; --- 覆盖安装时自动关闭旧版本进程 ---
!macro customInit
  DetailPrint "正在关闭旧版上号..."
  !insertmacro shutdownShangHaoProcesses
  !insertmacro shutdownShangHaoProcesses
!macroend
