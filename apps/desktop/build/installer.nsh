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

; electron-builder 的 --updated 路径默认会先原子重命名整个安装目录。
; 某些 Windows 环境会因目录句柄返回错误 2。进程已在前置阶段清理，
; 因此这里直接从 TEMP 删除程序目录；Roaming 下的用户数据不受影响。
!macro customRemoveFiles
  DetailPrint "正在替换旧版上号程序文件..."
  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR"
  Sleep 300

  ${if} ${FileExists} "$INSTDIR\ShangHao.exe"
    !insertmacro shutdownShangHaoProcesses
    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR"
  ${endif}

  ${if} ${FileExists} "$INSTDIR\ShangHao.exe"
    Abort "旧版上号程序文件仍被占用。"
  ${endif}
!macroend

!macro requestShangHaoQuitByName PROCESS_NAME EXECUTABLE_PATH
  ${nsProcess::FindProcess} "${PROCESS_NAME}" $R8
  ${if} $R8 == 0
  ${andIf} ${FileExists} "${EXECUTABLE_PATH}"
    DetailPrint "正在请求旧版上号退出..."
    ; Exec 不等待旧进程结束。旧版不认识退出参数时也不会把安装器卡住。
    Exec '"${EXECUTABLE_PATH}" --shanghao-quit-for-install'
    Sleep 1200
  ${endif}
!macroend

!macro requestShangHaoQuit
  ; 绝不能在应用没有运行时启动 EXE，否则安装器会制造一个新的占用进程。
  !insertmacro requestShangHaoQuitByName "ShangHao.exe" "$INSTDIR\ShangHao.exe"
  !insertmacro requestShangHaoQuitByName "上号.exe" "$INSTDIR\上号.exe"
  !insertmacro requestShangHaoQuitByName "PrivateVoice.exe" "$INSTDIR\PrivateVoice.exe"
!macroend

!macro killShangHaoProcessByName PROCESS_NAME
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "${PROCESS_NAME}" /T /F'
  Pop $0
!macroend

!macro killShangHaoProcessByInstallDir
  System::Call 'kernel32::GetCurrentProcessId() i .r9'
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$dir = '$INSTDIR'; $$installerPid = $R9; Get-CimInstance Win32_Process | Where-Object { $$_.ProcessId -ne $$installerPid -and $$_.ExecutablePath -and $$_.ExecutablePath.StartsWith($$dir, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
!macroend

!macro shutdownShangHaoProcesses
  !insertmacro requestShangHaoQuit

  ; 老版本可能还不认识 --shanghao-quit-for-install，或被托盘/悬浮窗留在后台。
  ; 所以同时按进程名和安装目录兜底清理，避免覆盖安装时文件被锁。
  !insertmacro killShangHaoProcessByName "ShangHao.exe"
  !insertmacro killShangHaoProcessByName "上号.exe"
  !insertmacro killShangHaoProcessByName "PrivateVoice.exe"
  !insertmacro killShangHaoProcessByInstallDir
  Sleep 500
!macroend

!macro migrateBrokenLegacyInstaller ROOT_KEY
  ReadRegStr $R7 ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${if} $R7 == "0.1.45"
  ${orIf} $R7 == "0.1.46"
  ${orIf} $R7 == "0.1.47"
  ${orIf} $R7 == "0.1.48"
    DetailPrint "正在修复旧版覆盖安装组件..."
    ; 0.1.45-0.1.48 的卸载器会误杀自身。这里跳过坏卸载器，
    ; 只清理程序目录；用户配置位于 AppData\Roaming，不会被删除。
    DeleteRegKey ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}"
    DeleteRegKey ${ROOT_KEY} "${INSTALL_REGISTRY_KEY}"
    SetOutPath "$TEMP"
    RMDir /r "$INSTDIR"
    CreateDirectory "$INSTDIR"
  ${endif}
!macroend

; 覆盖 electron-builder 默认的运行中检测：不要立刻把“无法关闭”抛给用户。
!macro customCheckAppRunning
  DetailPrint "正在清理旧版上号后台进程..."
  !insertmacro shutdownShangHaoProcesses
  !insertmacro migrateBrokenLegacyInstaller HKCU
  !insertmacro migrateBrokenLegacyInstaller HKLM
!macroend

; --- 覆盖安装时自动关闭旧版本进程 ---
!macro customInit
  DetailPrint "正在关闭旧版上号..."
  !insertmacro shutdownShangHaoProcesses
!macroend
