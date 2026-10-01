param(
  [string]$SourceImage = "docs/branding/github-avatar.png",
  [string]$OutputDirectory = "apps/desktop/build",
  [string]$RendererAssetsDirectory = "apps/desktop/src/renderer/src/assets",
  [string]$WebsiteAssetsDirectory = "website/public"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$workspace = Split-Path -Parent $PSScriptRoot
function Resolve-WorkspacePath([string]$Value) {
  if ([System.IO.Path]::IsPathRooted($Value)) { return [System.IO.Path]::GetFullPath($Value) }
  return [System.IO.Path]::GetFullPath((Join-Path $workspace $Value))
}

$sourcePath = Resolve-WorkspacePath $SourceImage
$buildPath = Resolve-WorkspacePath $OutputDirectory
$rendererPath = Resolve-WorkspacePath $RendererAssetsDirectory
$websitePath = Resolve-WorkspacePath $WebsiteAssetsDirectory
if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
  throw "Brand image not found: $sourcePath"
}

function Copy-CanonicalPng([string]$Destination) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
  if ($sourcePath -ne [System.IO.Path]::GetFullPath($Destination)) {
    Copy-Item -LiteralPath $sourcePath -Destination $Destination -Force
  }
}

function New-ResizedBitmap([System.Drawing.Image]$Source, [int]$Size) {
  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.DrawImage($Source, 0, 0, $Size, $Size)
  } finally {
    $graphics.Dispose()
  }
  return $bitmap
}

function Save-MultiSizeIco([System.Drawing.Image]$Source, [string]$Destination) {
  $entries = @()
  foreach ($size in @(16, 20, 24, 32, 40, 48, 64, 128, 256)) {
    $bitmap = New-ResizedBitmap -Source $Source -Size $size
    $stream = New-Object System.IO.MemoryStream
    try {
      $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
      $entries += [pscustomobject]@{ Size = $size; Bytes = $stream.ToArray() }
    } finally {
      $stream.Dispose()
      $bitmap.Dispose()
    }
  }

  $fileStream = [System.IO.File]::Open($Destination, [System.IO.FileMode]::Create)
  $writer = New-Object System.IO.BinaryWriter($fileStream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$entries.Count)
    $offset = 6 + 16 * $entries.Count
    foreach ($entry in $entries) {
      $dimension = if ($entry.Size -ge 256) { [byte]0 } else { [byte]$entry.Size }
      $writer.Write($dimension)
      $writer.Write($dimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$entry.Bytes.Length)
      $writer.Write([UInt32]$offset)
      $offset += $entry.Bytes.Length
    }
    foreach ($entry in $entries) { $writer.Write($entry.Bytes) }
  } finally {
    $writer.Dispose()
    $fileStream.Dispose()
  }
}

$sourceBitmap = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
  if ($sourceBitmap.RawFormat.Guid -ne [System.Drawing.Imaging.ImageFormat]::Png.Guid) {
    throw "The approved original must be a PNG file, not a renamed JPEG or other format."
  }
  if ($sourceBitmap.Width -ne $sourceBitmap.Height -or $sourceBitmap.Width -lt 256 -or $sourceBitmap.Width -gt 4096) {
    throw "The approved brand icon must be a square PNG between 256 and 4096 pixels."
  }
  # Validate before writing anything. Keep approved PNGs byte-identical; no
  # recoloring, cropping, sharpening, added glow or reconstructed artwork.
  Copy-CanonicalPng (Join-Path $workspace "docs/branding/github-avatar.png")
  Copy-CanonicalPng (Join-Path $buildPath "icon-master.png")
  Copy-CanonicalPng (Join-Path $buildPath "icon.png")
  Copy-CanonicalPng (Join-Path $rendererPath "brand-mark.png")
  Copy-CanonicalPng (Join-Path $websitePath "brand-mark.png")
  Save-MultiSizeIco -Source $sourceBitmap -Destination (Join-Path $buildPath "shanghao-icon-v4.ico")
  # Legacy filenames may still be referenced by an existing Windows shortcut.
  foreach ($name in @("shanghao-shortcut-v4.ico", "shanghao-icon.ico", "shanghao-shortcut.ico", "shanghao-icon-v3.ico", "shanghao-shortcut-v3.ico", "shanghao-icon-xl.ico", "shanghao-shortcut-xl.ico")) {
    Copy-Item -LiteralPath (Join-Path $buildPath "shanghao-icon-v4.ico") -Destination (Join-Path $buildPath $name) -Force
  }
  foreach ($name in @("tray-light.png", "tray-dark.png")) {
    Copy-CanonicalPng (Join-Path $buildPath $name)
  }
  $sourceRecord = [ordered]@{
    source = "docs/branding/github-avatar.png"
    sha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    width = $sourceBitmap.Width
    height = $sourceBitmap.Height
    policy = "Exact approved original; resize only for ICO frames."
    icoSizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
  }
  [System.IO.File]::WriteAllText((Join-Path $buildPath "brand-source.json"), ($sourceRecord | ConvertTo-Json -Depth 3), (New-Object System.Text.UTF8Encoding $false))
} finally {
  $sourceBitmap.Dispose()
}

Write-Host "Synchronized app, shortcut, renderer and website icons from $sourcePath"
