$ErrorActionPreference = "Continue"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$desktop = [Environment]::GetFolderPath("Desktop")
$workDir = Join-Path $desktop "low-latency-profile-$stamp"
$logPath = Join-Path $workDir "enable-low-latency-profile.log"
$zipPath = Join-Path $workDir "ViVeTool.zip"
$extractDir = Join-Path $workDir "ViVeTool"

New-Item -ItemType Directory -Path $workDir -Force | Out-Null

function Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
    Write-Host $line
    Add-Content -Path $logPath -Value $line -Encoding UTF8
}

function Try-Run {
    param(
        [string]$Name,
        [scriptblock]$Action
    )
    try {
        & $Action
        Log "OK: $Name"
    } catch {
        Log "FAILED: $Name - $($_.Exception.Message)"
    }
}

Log "Low Latency Profile enable started."
Log "Work folder: $workDir"

Try-Run "Create system restore point" {
    Checkpoint-Computer -Description "Before enabling Windows Low Latency Profile $stamp" -RestorePointType "MODIFY_SETTINGS"
}

Try-Run "Download latest ViVeTool release" {
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/thebookisclosed/ViVe/releases/latest" -Headers @{ "User-Agent" = "Codex" }
    $asset = $release.assets | Where-Object { $_.name -match "ViVeTool.*\.zip$" } | Select-Object -First 1
    if (-not $asset) {
        throw "Could not find ViVeTool zip asset in latest release."
    }
    Log "Downloading: $($asset.browser_download_url)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Headers @{ "User-Agent" = "Codex" }
}

Try-Run "Extract ViVeTool" {
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force
}

$vivetool = Join-Path $extractDir "ViVeTool.exe"
if (-not (Test-Path $vivetool)) {
    $vivetool = (Get-ChildItem -Path $extractDir -Recurse -Filter "ViVeTool.exe" | Select-Object -First 1).FullName
}

if (-not $vivetool) {
    Log "FAILED: ViVeTool.exe was not found after extraction."
    exit 1
}

Try-Run "Enable Low Latency Profile bundle ID 58989092" {
    $output = & $vivetool /enable /id:58989092 2>&1
    $output | ForEach-Object { Log "ViVeTool: $($_.ToString())" }
}

Try-Run "Enable Low Latency Profile related IDs 60716524 and 61391826" {
    $output = & $vivetool /enable /id:60716524,61391826 2>&1
    $output | ForEach-Object { Log "ViVeTool: $($_.ToString())" }
}

Try-Run "Query configured feature IDs" {
    foreach ($id in @("58989092", "60716524", "61391826")) {
        $output = & $vivetool /query /id:$id 2>&1
        $output | ForEach-Object { Log "Query $id: $($_.ToString())" }
    }
}

Log "Low Latency Profile enable finished. Reboot is required."
Log "Log path: $logPath"
