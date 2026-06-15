$ErrorActionPreference = "Continue"

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$desktop = [Environment]::GetFolderPath("Desktop")
$backupDir = Join-Path $desktop "gaming-opt-admin-backup-$stamp"
$logPath = Join-Path $backupDir "gaming-optimize.log"
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

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

Log "Gaming optimization started."
Log "Backup folder: $backupDir"

Try-Run "Create system restore point" {
    Checkpoint-Computer -Description "Before gaming optimization $stamp" -RestorePointType "MODIFY_SETTINGS"
}

Try-Run "Export startup and gaming registry backup" {
    reg export "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" (Join-Path $backupDir "HKCU-Run.reg") /y | Out-Null
    reg export "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" (Join-Path $backupDir "HKLM-Run.reg") /y | Out-Null
    reg export "HKCU\System\GameConfigStore" (Join-Path $backupDir "HKCU-GameConfigStore.reg") /y | Out-Null
    reg export "HKLM\SOFTWARE\Policies\Microsoft\Windows\GameDVR" (Join-Path $backupDir "HKLM-GameDVR-Policy.reg") /y 2>$null | Out-Null
    reg export "HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers" (Join-Path $backupDir "HKLM-GraphicsDrivers.reg") /y | Out-Null
}

Try-Run "Disable Game DVR and background capture" {
    New-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\GameDVR" -Name AppCaptureEnabled -Type DWord -Value 0
    Set-ItemProperty -Path "HKCU:\System\GameConfigStore" -Name GameDVR_Enabled -Type DWord -Value 0
    New-Item -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" -Force | Out-Null
    Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Microsoft\Windows\GameDVR" -Name AllowGameDVR -Type DWord -Value 0
}

Try-Run "Enable Windows Game Mode" {
    New-Item -Path "HKCU:\Software\Microsoft\GameBar" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\GameBar" -Name AutoGameModeEnabled -Type DWord -Value 1
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\GameBar" -Name AllowAutoGameMode -Type DWord -Value 1
}

Try-Run "Enable hardware accelerated GPU scheduling" {
    New-Item -Path "HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers" -Force | Out-Null
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\GraphicsDrivers" -Name HwSchMode -Type DWord -Value 2
}

Try-Run "Disable Edge startup boost and background mode" {
    New-Item -Path "HKCU:\Software\Microsoft\Edge" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Edge" -Name StartupBoostEnabled -Type DWord -Value 0
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Edge" -Name BackgroundModeEnabled -Type DWord -Value 0
}

Try-Run "Remove heavy nonessential startup entries" {
    $hkcuRun = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
    foreach ($name in @(
        "cloudmusic",
        "MicrosoftEdgeAutoLaunch_1BE32DAFAE0792EAE9357FE2D22C692A",
        "OneDrive",
        "Microsoft.Lists",
        "RiotClient",
        "Steam"
    )) {
        Remove-ItemProperty -Path $hkcuRun -Name $name -ErrorAction SilentlyContinue
    }

    Remove-ItemProperty -Path "HKLM:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "ACE-Tray" -ErrorAction SilentlyContinue
}

Try-Run "Stop and disable ToDesk background service" {
    Get-Process -Name ToDesk -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Stop-Service -Name ToDesk_Service -Force -ErrorAction SilentlyContinue
    Set-Service -Name ToDesk_Service -StartupType Disabled -ErrorAction SilentlyContinue
    Get-ScheduledTask -ErrorAction SilentlyContinue |
        Where-Object { $_.TaskName -match "ToDesk|ToDesk" -or $_.TaskPath -match "ToDesk" } |
        Disable-ScheduledTask -ErrorAction SilentlyContinue | Out-Null
}

Try-Run "Keep high performance power plan active" {
    powercfg /setactive SCHEME_MIN | Out-Null
}

Try-Run "Report virtualization-related Windows features" {
    foreach ($feature in @("VirtualMachinePlatform", "Microsoft-Hyper-V-All", "Windows-Hypervisor-Platform")) {
        $state = (Get-WindowsOptionalFeature -Online -FeatureName $feature -ErrorAction SilentlyContinue).State
        Log "Feature state: $feature = $state"
    }
}

Log "Gaming optimization finished. Reboot is recommended."
Log "Log path: $logPath"
