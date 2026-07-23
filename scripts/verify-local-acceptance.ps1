param(
  [switch]$Package
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Check {
  param(
    [string]$Name,
    [scriptblock]$Action
  )

  Write-Host "`n[CHECK] $Name" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE"
  }
  Write-Host "[PASS] $Name" -ForegroundColor Green
}

Push-Location $root
try {
  Invoke-Check "Workspace typecheck" {
    corepack pnpm typecheck
  }
  Invoke-Check "Desktop smoke tests" {
    corepack pnpm --dir apps/desktop test:smoke
  }
  Invoke-Check "Three-peer signaling audio route" {
    corepack pnpm test:three-peer-audio
  }
  Invoke-Check "Production build" {
    corepack pnpm build
  }

  if ($Package) {
    Invoke-Check "Windows local package" {
      corepack pnpm dist:win
    }
    Invoke-Check "Packaged runtime resources" {
      corepack pnpm release:verify-package
    }
  }

  Write-Host "`nAll automated acceptance checks passed." -ForegroundColor Green
  Write-Host "Next: run the real multi-device checklist in docs/local-multiplayer-acceptance.md."
  if ($Package) {
    Write-Host "Local package directory: apps/desktop/release"
  }
} finally {
  Pop-Location
}
