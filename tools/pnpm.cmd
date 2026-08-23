@echo off
where corepack >nul 2>&1
if not errorlevel 1 (
  corepack pnpm %*
  exit /b
)

for /f "delims=" %%P in ('where pnpm.cmd 2^>nul') do (
  if /I not "%%~fP"=="%~f0" (
    call "%%~fP" %*
    exit /b
  )
)

echo ShangHao could not find pnpm. Install pnpm 10.34.5 or enable Corepack. 1>&2
exit /b 1
