$checks = @(
  @{
    Name = "Git"
    Commands = @("git")
    Paths = @("C:\Program Files\Git\cmd\git.exe")
  },
  @{
    Name = "Node.js"
    Commands = @("node")
    Paths = @("C:\Program Files\nodejs\node.exe")
  },
  @{
    Name = "pnpm"
    Commands = @("pnpm")
    Paths = @(
      (Join-Path $env:LOCALAPPDATA "pnpm\pnpm.cmd"),
      (Join-Path $env:LOCALAPPDATA "pnpm\pnpm.ps1")
    )
  },
  @{
    Name = "Tailscale"
    Commands = @("tailscale")
    Paths = @(
      "C:\Program Files\Tailscale\tailscale.exe",
      "C:\Program Files (x86)\Tailscale\tailscale.exe"
    )
  }
)

foreach ($check in $checks) {
  $resolved = $null

  foreach ($commandName in $check.Commands) {
    $command = Get-Command $commandName -ErrorAction SilentlyContinue
    if ($null -ne $command) {
      $resolved = $command.Source
      break
    }
  }

  if ($null -eq $resolved) {
    foreach ($path in $check.Paths) {
      if ($path -and (Test-Path $path)) {
        $resolved = $path
        break
      }
    }
  }

  if ($null -eq $resolved) {
    Write-Host "[missing] $($check.Name)" -ForegroundColor Yellow
  } else {
    Write-Host "[ok] $($check.Name): $resolved" -ForegroundColor Green
  }
}
