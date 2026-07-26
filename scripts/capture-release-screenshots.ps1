param(
  [string]$OutputDirectory = "docs/assets"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$workspaceRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$desktopDirectory = Join-Path $workspaceRoot "apps/desktop"
$electronCommand = Join-Path $desktopDirectory "node_modules/.bin/electron.cmd"
$viteCommand = Join-Path $desktopDirectory "node_modules/.bin/vite.cmd"
$rendererUrl = "http://127.0.0.1:5173"

if (-not (Test-Path $electronCommand)) {
  throw "Electron runtime not found. Run corepack pnpm install first."
}

if (-not (Test-Path $viteCommand)) {
  throw "Vite runtime not found. Run corepack pnpm install first."
}

function Test-RendererReady {
  try {
    $response = Invoke-WebRequest -Uri $rendererUrl -UseBasicParsing -TimeoutSec 1
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Stop-ProcessTree {
  param([int]$ProcessId)

  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }

  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

& corepack pnpm --dir $desktopDirectory build
if ($LASTEXITCODE -ne 0) {
  throw "Visual test build failed."
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

$viteProcess = $null

try {
  if (-not (Test-RendererReady)) {
    $viteProcess = Start-Process -FilePath $viteCommand `
      -ArgumentList "--host", "127.0.0.1", "--port", "5173", "--strictPort" `
      -WorkingDirectory $desktopDirectory `
      -WindowStyle Hidden `
      -PassThru

    for ($index = 0; $index -lt 60; $index++) {
      if (Test-RendererReady) {
        break
      }

      if ($viteProcess.HasExited) {
        throw "Vite renderer server exited early with code $($viteProcess.ExitCode)."
      }

      Start-Sleep -Milliseconds 250
    }
  }

  if (-not (Test-RendererReady)) {
    throw "Vite renderer server did not become ready at $rendererUrl."
  }

  foreach ($capture in $captures) {
    $target = Join-Path $resolvedOutput $capture.File

    if (Test-Path $target) {
      Remove-Item $target -Force
    }

    $env:SHANGHAO_CAPTURE_MODE = $capture.Mode
    $env:SHANGHAO_CAPTURE_PATH = $target
    $env:SHANGHAO_CAPTURE_EXIT = "1"
    $captureUrl = if ($capture.Mode -eq "settings") {
      "$rendererUrl/?visualCapture=settings"
    } else {
      "$rendererUrl/"
    }
    $env:VITE_DEV_SERVER_URL = $captureUrl

    $process = Start-Process -FilePath $electronCommand `
      -ArgumentList "." `
      -WorkingDirectory $desktopDirectory `
      -PassThru

    for ($index = 0; $index -lt 60; $index++) {
      if (Test-Path $target) {
        break
      }

      if ($process.HasExited) {
        throw "Capture process for $($capture.Mode) exited early with code $($process.ExitCode)."
      }

      Start-Sleep -Milliseconds 500
    }

    if (-not (Test-Path $target)) {
      Stop-ProcessTree -ProcessId $process.Id
      throw "Capture failed for $($capture.Mode)."
    }

    if (-not $process.WaitForExit(5000)) {
      Stop-ProcessTree -ProcessId $process.Id
    }
  }
} finally {
  Remove-Item Env:SHANGHAO_CAPTURE_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:SHANGHAO_CAPTURE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:SHANGHAO_CAPTURE_EXIT -ErrorAction SilentlyContinue
  Remove-Item Env:VITE_DEV_SERVER_URL -ErrorAction SilentlyContinue

  if ($viteProcess -and -not $viteProcess.HasExited) {
    Stop-ProcessTree -ProcessId $viteProcess.Id
  }
}

Write-Host "Generated release screenshots in $resolvedOutput"
