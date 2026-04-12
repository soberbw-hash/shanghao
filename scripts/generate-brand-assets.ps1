param(
  [string]$SourceImage = "C:\Users\sober\Desktop\c609cfce-89d6-4b9e-bc4f-cd6041f94a42.png",
  [string]$OutputDirectory = "apps/desktop/build",
  [string]$RendererAssetsDirectory = "apps/desktop/src/renderer/src/assets",
  [string]$GithubAssetsDirectory = "docs/branding"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function New-RoundedPath {
  param(
    [System.Drawing.RectangleF]$Rect,
    [float]$Radius
  )

  $diameter = $Radius * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
  $path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Save-Png {
  param(
    [System.Drawing.Image]$Image,
    [string]$Path
  )

  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $Image.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-SquareMasterFromSource {
  param(
    [System.Drawing.Bitmap]$Source,
    [int]$Size
  )

  $canvas = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::FromArgb(245, 247, 250))

  $side = [Math]::Min($Source.Width, $Source.Height)
  $cropX = [int](($Source.Width - $side) / 2)
  $cropY = [int](($Source.Height - $side) / 2)
  $sourceRect = [System.Drawing.Rectangle]::new($cropX, $cropY, $side, $side)
  $targetRect = [System.Drawing.Rectangle]::new(0, 0, $Size, $Size)
  $graphics.DrawImage($Source, $targetRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.Dispose()

  return $canvas
}

function New-ResizedBitmap {
  param(
    [System.Drawing.Image]$Source,
    [int]$Size
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.DrawImage($Source, 0, 0, $Size, $Size)
  $graphics.Dispose()
  return $bitmap
}

function Save-MultiSizeIco {
  param(
    [System.Drawing.Image]$Source,
    [int[]]$Sizes,
    [string]$Path
  )

  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null

  $entries = @()
  foreach ($size in $Sizes) {
    $bitmap = New-ResizedBitmap -Source $Source -Size $size
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    $entries += [pscustomobject]@{
      Size  = $size
      Bytes = $stream.ToArray()
    }
    $stream.Dispose()
    $bitmap.Dispose()
  }

  $fileStream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create)
  $writer = New-Object System.IO.BinaryWriter($fileStream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$entries.Count)

    $offset = 6 + (16 * $entries.Count)
    foreach ($entry in $entries) {
      $dimensionByte = if ($entry.Size -ge 256) { [byte]0 } else { [byte]$entry.Size }
      $writer.Write($dimensionByte)
      $writer.Write($dimensionByte)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$entry.Bytes.Length)
      $writer.Write([UInt32]$offset)
      $offset += $entry.Bytes.Length
    }

    foreach ($entry in $entries) {
      $writer.Write($entry.Bytes)
    }
  } finally {
    $writer.Dispose()
    $fileStream.Dispose()
  }
}

function New-TrayBitmap {
  param(
    [int]$Size,
    [System.Drawing.Color]$StrokeColor
  )

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $pen = New-Object System.Drawing.Pen($StrokeColor, [float]($Size * 0.11))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $arcRect = [System.Drawing.RectangleF]::new(
    [float]($Size * 0.15),
    [float]($Size * 0.08),
    [float]($Size * 0.70),
    [float]($Size * 0.70)
  )
  $graphics.DrawArc($pen, $arcRect, 210, 120)

  $cupBrush = New-Object System.Drawing.SolidBrush($StrokeColor)
  $leftCup = New-RoundedPath -Rect ([System.Drawing.RectangleF]::new(
      [float]($Size * 0.16),
      [float]($Size * 0.46),
      [float]($Size * 0.20),
      [float]($Size * 0.26)
    )) -Radius ([float]($Size * 0.08))
  $rightCup = New-RoundedPath -Rect ([System.Drawing.RectangleF]::new(
      [float]($Size * 0.64),
      [float]($Size * 0.46),
      [float]($Size * 0.20),
      [float]($Size * 0.26)
    )) -Radius ([float]($Size * 0.08))
  $leftArm = New-RoundedPath -Rect ([System.Drawing.RectangleF]::new(
      [float]($Size * 0.30),
      [float]($Size * 0.40),
      [float]($Size * 0.12),
      [float]($Size * 0.34)
    )) -Radius ([float]($Size * 0.06))
  $rightArm = New-RoundedPath -Rect ([System.Drawing.RectangleF]::new(
      [float]($Size * 0.58),
      [float]($Size * 0.40),
      [float]($Size * 0.12),
      [float]($Size * 0.34)
    )) -Radius ([float]($Size * 0.06))

  $graphics.FillPath($cupBrush, $leftCup)
  $graphics.FillPath($cupBrush, $rightCup)
  $graphics.FillPath($cupBrush, $leftArm)
  $graphics.FillPath($cupBrush, $rightArm)

  $leftCup.Dispose()
  $rightCup.Dispose()
  $leftArm.Dispose()
  $rightArm.Dispose()
  $cupBrush.Dispose()
  $pen.Dispose()
  $graphics.Dispose()
  return $bitmap
}

function Save-TextFile {
  param(
    [string]$Content,
    [string]$Path
  )

  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path $SourceImage)) {
  throw "Source image not found: $SourceImage"
}

$sourceBitmap = [System.Drawing.Bitmap]::FromFile($SourceImage)
try {
  $master = New-SquareMasterFromSource -Source $sourceBitmap -Size 1024

  $iconMasterPath = Join-Path $OutputDirectory "icon-master.png"
  $iconPngPath = Join-Path $OutputDirectory "icon.png"
  $iconIcoPath = Join-Path $OutputDirectory "icon.ico"
  $trayDarkPath = Join-Path $OutputDirectory "tray-dark.png"
  $trayLightPath = Join-Path $OutputDirectory "tray-light.png"
  $logoSvgPath = Join-Path $RendererAssetsDirectory "brand-mark.svg"
  $githubAvatarPath = Join-Path $GithubAssetsDirectory "github-avatar.png"

  Save-Png -Image $master -Path $iconMasterPath

  $largePng = New-ResizedBitmap -Source $master -Size 512
  Save-Png -Image $largePng -Path $iconPngPath
  $largePng.Dispose()

  Save-MultiSizeIco -Source $master -Sizes @(16, 20, 24, 32, 40, 48, 64, 128, 256) -Path $iconIcoPath

  $trayDark = New-TrayBitmap -Size 64 -StrokeColor ([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $trayLight = New-TrayBitmap -Size 64 -StrokeColor ([System.Drawing.Color]::FromArgb(255, 17, 24, 39))
  Save-Png -Image $trayDark -Path $trayDarkPath
  Save-Png -Image $trayLight -Path $trayLightPath
  $trayDark.Dispose()
  $trayLight.Dispose()

  $githubAvatar = New-ResizedBitmap -Source $master -Size 512
  Save-Png -Image $githubAvatar -Path $githubAvatarPath
  $githubAvatar.Dispose()

  $logoSvg = @"
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none">
  <defs>
    <linearGradient id="panel" x1="18" y1="16" x2="110" y2="112" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#23262d" />
      <stop offset="1" stop-color="#111318" />
    </linearGradient>
    <filter id="shadow" x="0" y="0" width="128" height="128" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#111827" flood-opacity="0.18"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <rect x="10" y="10" width="108" height="108" rx="30" fill="url(#panel)"/>
    <rect x="12" y="12" width="104" height="104" rx="28" stroke="#2b2f36" stroke-width="2"/>
  </g>
  <path d="M35 71V58c0-16.016 12.984-29 29-29s29 12.984 29 29v13" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round"/>
  <rect x="29" y="59" width="12" height="29" rx="6" fill="#FFFFFF"/>
  <rect x="87" y="59" width="12" height="29" rx="6" fill="#FFFFFF"/>
  <rect x="40" y="54" width="13" height="36" rx="6.5" fill="#FFFFFF"/>
  <rect x="75" y="54" width="13" height="36" rx="6.5" fill="#FFFFFF"/>
  <path d="M52 38c7-6 17-6 24 0" stroke="#FFFFFF" stroke-width="9" stroke-linecap="round"/>
</svg>
"@
  Save-TextFile -Content $logoSvg -Path $logoSvgPath

  $master.Dispose()
} finally {
  $sourceBitmap.Dispose()
}

Write-Host "Generated brand assets from:"
Write-Host "  Source: $SourceImage"
Write-Host "  Icon master: $iconMasterPath"
Write-Host "  Icon png: $iconPngPath"
Write-Host "  Icon ico: $iconIcoPath"
Write-Host "  Tray dark: $trayDarkPath"
Write-Host "  Tray light: $trayLightPath"
Write-Host "  UI logo: $logoSvgPath"
Write-Host "  GitHub avatar: $githubAvatarPath"
