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

!macro killShangHaoProcess PROCESS_NAME
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "${PROCESS_NAME}" /T /F'
  Pop $0
!macroend

; --- 覆盖安装时自动关闭旧版本进程 ---
!macro customInit
  DetailPrint "正在关闭旧版上号..."

  ; 先请求旧版本自己退出，这样托盘、悬浮窗、快捷键都能被正常清理。
  ${if} ${FileExists} "$INSTDIR\ShangHao.exe"
    nsExec::ExecToLog '"$INSTDIR\ShangHao.exe" --shanghao-quit-for-install'
    Pop $0
  ${endif}

  Sleep 1200

  ; 再做强制兜底。多轮重试可以避开 WebView / 托盘延迟退出造成的文件锁。
  !insertmacro killShangHaoProcess "ShangHao.exe"
  !insertmacro killShangHaoProcess "上号.exe"
  !insertmacro killShangHaoProcess "PrivateVoice.exe"
  Sleep 700
  !insertmacro killShangHaoProcess "ShangHao.exe"
  !insertmacro killShangHaoProcess "上号.exe"
  !insertmacro killShangHaoProcess "PrivateVoice.exe"
  Sleep 700
  !insertmacro killShangHaoProcess "ShangHao.exe"
  !insertmacro killShangHaoProcess "上号.exe"
  !insertmacro killShangHaoProcess "PrivateVoice.exe"
  Sleep 700
!macroend
