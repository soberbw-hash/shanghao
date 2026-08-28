[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string] $IdentityFile,

  [string] $RemoteUser = "root",
  [string] $RemoteHost = "118.25.103.107",
  [string] $RemoteDir = "/root/shanghao",
  [string] $RemoteService = "shanghao-relay"
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$ssh = Get-Command ssh.exe -ErrorAction Stop
$scp = Get-Command scp.exe -ErrorAction Stop
$sourceFiles = @(
  "packages/signaling/src/account-service.ts",
  "packages/signaling/src/server.ts",
  "scripts/apply-cloudbase-relay.sh"
)

foreach ($relativePath in $sourceFiles) {
  $localPath = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $localPath -PathType Leaf)) {
    throw "Missing local deployment file: $localPath"
  }
}

$identityPath = (Resolve-Path -LiteralPath $IdentityFile).Path
$target = "{0}@{1}" -f $RemoteUser, $RemoteHost
$stageStamp = Get-Date -Format "yyyyMMddHHmmss"
$remoteStage = "/home/$RemoteUser/.shanghao-cloudbase-sync-$stageStamp"

function Invoke-Ssh([string[]] $Arguments) {
  & $ssh.Source @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "SSH command failed with exit code $LASTEXITCODE. No remote restart was performed by this client script."
  }
}

function Invoke-Scp([string[]] $Arguments) {
  & $scp.Source @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "SCP command failed with exit code $LASTEXITCODE. No remote restart was performed by this client script."
  }
}

Write-Host "Preparing a temporary CloudBase Relay staging directory on $target ..."
Invoke-Ssh @("-i", $identityPath, $target, "mkdir -p '$remoteStage/packages/signaling/src'")

$remoteSource = "$target`:$remoteStage/packages/signaling/src/"
Invoke-Scp @("-i", $identityPath, (Join-Path $repoRoot "packages/signaling/src/account-service.ts"), $remoteSource)
Invoke-Scp @("-i", $identityPath, (Join-Path $repoRoot "packages/signaling/src/server.ts"), $remoteSource)
Invoke-Scp @("-i", $identityPath, (Join-Path $repoRoot "scripts/apply-cloudbase-relay.sh"), "$target`:$remoteStage/apply-cloudbase-relay.sh")

Write-Host "Applying staged files, rebuilding, restarting $RemoteService, and checking /health ..."
Invoke-Ssh @(
  "-i", $identityPath,
  $target,
  "chmod 700 '$remoteStage/apply-cloudbase-relay.sh' && sudo bash '$remoteStage/apply-cloudbase-relay.sh' '$RemoteDir' '$RemoteService' '$remoteStage'"
)

Write-Host "CloudBase Relay sync completed. The remote .env was not overwritten."
