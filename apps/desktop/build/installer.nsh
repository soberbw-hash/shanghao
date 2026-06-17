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

; --- 覆盖安装时自动关闭旧版本进程，避免"软件正在使用中" ---
!macro customInit
  Var /GLOBAL _retryCount
  StrCpy $_retryCount 0

  _killLoop:
    ; 检测 ShangHao.exe 是否在运行
    nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ShangHao.exe" /NH'
    Pop $_nsExecResult
    Pop $_nsExecOutput

    ; 如果 tasklist 输出包含 ShangHao.exe，说明还在运行
    ${If} $_nsExecOutput == ""
      DetailPrint "ShangHao.exe 未运行，继续安装"
      Goto _killDone
    ${EndIf}

    ; 尝试温和关闭
    DetailPrint "正在关闭 ShangHao.exe... (尝试 ${_retryCount}/3)"
    nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "ShangHao.exe"'
    Sleep 2000

    ; 再次检测
    nsExec::ExecToStack '"$SYSDIR\tasklist.exe" /FI "IMAGENAME eq ShangHao.exe" /NH'
    Pop $_nsExecResult
    Pop $_nsExecOutput

    ${If} $_nsExecOutput == ""
      DetailPrint "ShangHao.exe 已关闭"
      Goto _killDone
    ${EndIf}

    ; 强制结束
    DetailPrint "ShangHao.exe 仍在运行，强制结束..."
    nsExec::ExecToLog '"$SYSDIR\taskkill.exe" /IM "ShangHao.exe" /T /F'
    Sleep 1000

    ; 增加重试计数
    IntOp $_retryCount $_retryCount + 1

    ; 检查是否超过 3 次
    ${If} $_retryCount < 3
      Goto _killLoop
    ${EndIf}

    ; 3 次后仍失败，显示提示
    MessageBox MB_OK|MB_ICONEXCLAMATION "请在任务管理器中结束 ShangHao.exe 后点击确定继续安装。"
    Goto _killLoop

  _killDone:
!macroend
