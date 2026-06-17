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

; --- 覆盖安装时自动关闭旧版本进程 ---
!macro customInit
  ; 第一次尝试：温和关闭
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "ShangHao.exe"'
  Pop $0
  Sleep 2000

  ; 第二次尝试：强制结束
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "ShangHao.exe" /T /F'
  Pop $0
  Sleep 1000

  ; 第三次尝试：再次强制
  nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "ShangHao.exe" /T /F'
  Pop $0
  Sleep 1000
!macroend
