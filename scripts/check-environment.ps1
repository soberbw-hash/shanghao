$checks = @(
  @{ Name = "Git"; Command = "git" },
  @{ Name = "Node.js"; Command = "node" },
  @{ Name = "pnpm"; Command = "pnpm" },
  @{ Name = "Tailscale"; Command = "tailscale" }
)

foreach ($check in $checks) {
  $command = Get-Command $check.Command -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    Write-Host "[missing] $($check.Name)" -ForegroundColor Yellow
  } else {
    Write-Host "[ok] $($check.Name): $($command.Source)" -ForegroundColor Green
  }
}
