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

# Keep every full-resolution PNG byte-identical to the approved source. Only ICO
# frames require resizing for Windows shell, executable and installer formats.
Copy-CanonicalPng (Join-Path $buildPath "icon-master.png")
Copy-CanonicalPng (Join-Path $buildPath "icon.png")
Copy-CanonicalPng (Join-Path $rendererPath "brand-mark.png")
Copy-CanonicalPng (Join-Path $websitePath "brand-mark.png")

$sourceBitmap = [System.Drawing.Bitmap]::FromFile($sourcePath)
try {
  if ($sourceBitmap.Width -ne 512 -or $sourceBitmap.Height -ne 512) {
    throw "The approved brand icon must be 512 x 512 pixels."
  }
  Save-MultiSizeIco -Source $sourceBitmap -Destination (Join-Path $buildPath "shanghao-icon-v4.ico")
  Save-MultiSizeIco -Source $sourceBitmap -Destination (Join-Path $buildPath "shanghao-shortcut-v4.ico")
} finally {
  $sourceBitmap.Dispose()
}

Write-Host "Synchronized app, shortcut, renderer and website icons from $sourcePath"
