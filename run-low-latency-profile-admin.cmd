@echo off
setlocal
set "BASE=%USERPROFILE%\Desktop\low-latency-profile-manual-20260522-205246"
set "VIVE=%BASE%\ViVeTool.exe"
set "LOG=%BASE%\vivetool-enable.log"

echo Low Latency Profile enable started.>"%LOG%"
echo ViVeTool: %VIVE%>>"%LOG%"
echo.>>"%LOG%"

"%VIVE%" /enable /id:58989092 >>"%LOG%" 2>&1
echo.>>"%LOG%"
"%VIVE%" /enable /id:60716524,61391826 >>"%LOG%" 2>&1
echo.>>"%LOG%"
"%VIVE%" /query /id:58989092 >>"%LOG%" 2>&1
echo.>>"%LOG%"
"%VIVE%" /query /id:60716524 >>"%LOG%" 2>&1
echo.>>"%LOG%"
"%VIVE%" /query /id:61391826 >>"%LOG%" 2>&1

type "%LOG%"
echo.
echo Done. Please reboot Windows.
pause
