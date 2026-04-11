param(
  [string]$ExecutableDirectory = "apps/desktop/release/win-unpacked",
  [string]$OutputDirectory = "docs/assets"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$resolvedExeDirectory = Resolve-Path $ExecutableDirectory
$resolvedExe = Get-ChildItem $resolvedExeDirectory -Filter "*.exe" -File |
  Where-Object { $_.Name -notlike "*Setup*" -and $_.Name -notlike "*unins*" } |
  Sort-Object Name |
  Select-Object -First 1 -ExpandProperty FullName

if (-not $resolvedExe) {
  throw "未找到可用于截图的程序：$resolvedExeDirectory"
}
$resolvedOutput = Resolve-Path $OutputDirectory -ErrorAction SilentlyContinue

if (-not $resolvedOutput) {
  New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
  $resolvedOutput = Resolve-Path $OutputDirectory
}

$captures = @(
  @{ Mode = "home"; File = "release-home.png" },
  @{ Mode = "settings"; File = "release-settings.png" }
)

foreach ($capture in $captures) {
  $target = Join-Path $resolvedOutput $capture.File

  if (Test-Path $target) {
    Remove-Item $target -Force
  }

  $env:SHANGHAO_CAPTURE_MODE = $capture.Mode
  $env:SHANGHAO_CAPTURE_PATH = $target
  $env:SHANGHAO_CAPTURE_EXIT = "1"

  $process = Start-Process -FilePath $resolvedExe `
    -WorkingDirectory (Split-Path $resolvedExe) `
    -PassThru

  for ($index = 0; $index -lt 40; $index++) {
    if (Test-Path $target) {
      break
    }

    Start-Sleep -Milliseconds 500
  }

  if (-not (Test-Path $target)) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    } catch {
    }

    throw "截图生成失败：$($capture.Mode)"
  }

  Remove-Item Env:SHANGHAO_CAPTURE_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:SHANGHAO_CAPTURE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:SHANGHAO_CAPTURE_EXIT -ErrorAction SilentlyContinue
}

Write-Host "Generated release screenshots in $resolvedOutput"
