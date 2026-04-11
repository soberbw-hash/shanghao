param(
  [string]$OutputPng = "apps/desktop/build/icon.png",
  [string]$OutputIco = "apps/desktop/build/icon.ico",
  [int]$PreviewSize = 512,
  [int]$IconSize = 256
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

function New-BrandBitmap {
  param([int]$Size)

  $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.Clear([System.Drawing.Color]::Transparent)

  $padding = [float]($Size * 0.145)
  $surface = [System.Drawing.RectangleF]::new(
    [float]$padding,
    [float]($padding * 0.78),
    [float]($Size - ($padding * 2)),
    [float]($Size - ($padding * 2))
  )
  $surfaceRadius = [float]($Size * 0.2)
  $surfacePath = New-RoundedPath -Rect $surface -Radius $surfaceRadius

  $backgroundBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    ([System.Drawing.PointF]::new([float]$surface.Left, [float]$surface.Top)),
    ([System.Drawing.PointF]::new([float]$surface.Right, [float]$surface.Bottom)),
    ([System.Drawing.ColorTranslator]::FromHtml("#0c1829")),
    ([System.Drawing.ColorTranslator]::FromHtml("#16273b"))
  )
  $graphics.FillPath($backgroundBrush, $surfacePath)

  $glowPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $glowBounds = [System.Drawing.RectangleF]::new(
    [float]($Size * 0.52),
    [float]($Size * 0.04),
    [float]($Size * 0.42),
    [float]($Size * 0.42)
  )
  $glowPath.AddEllipse($glowBounds)
  $glowBrush = New-Object System.Drawing.Drawing2D.PathGradientBrush($glowPath)
  $glowBrush.CenterColor = [System.Drawing.Color]::FromArgb(132, 121, 215, 255)
  $glowBrush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 121, 215, 255))
  $graphics.FillEllipse($glowBrush, $glowBounds)

  $strokePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(22, 255, 255, 255), [float]($Size * 0.012))
  $graphics.DrawPath($strokePen, $surfacePath)

  $barHeight = [float]($Size * 0.11)
  $barWidth = [float]($Size * 0.43)
  $stemWidth = [float]($Size * 0.11)
  $stemHeight = [float]($Size * 0.46)
  $markX = [float]($Size * 0.29)
  $markY = [float]($Size * 0.255)
  $whiteBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#eff9ff"))

  $topBarPath = New-RoundedPath -Rect ([System.Drawing.RectangleF]::new([float]$markX, [float]$markY, [float]$barWidth, [float]$barHeight)) -Radius ($barHeight / 2)
  $stemPath = New-RoundedPath -Rect ([System.Drawing.RectangleF]::new([float]($markX + ($barWidth - $stemWidth) / 2), [float]$markY, [float]$stemWidth, [float]$stemHeight)) -Radius ($stemWidth / 2)
  $graphics.FillPath($whiteBrush, $topBarPath)
  $graphics.FillPath($whiteBrush, $stemPath)

  $dotSize = [float]($Size * 0.188)
  $dotX = [float]($Size * 0.585)
  $dotY = [float]($Size * 0.585)
  $accentBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    ([System.Drawing.PointF]::new([float]$dotX, [float]$dotY)),
    ([System.Drawing.PointF]::new([float]($dotX + $dotSize), [float]($dotY + $dotSize))),
    ([System.Drawing.ColorTranslator]::FromHtml("#e3f7ff")),
    ([System.Drawing.ColorTranslator]::FromHtml("#6ecfff"))
  )
  $graphics.FillEllipse($accentBrush, $dotX, $dotY, $dotSize, $dotSize)

  $highlightSize = [float]($dotSize * 0.22)
  $graphics.FillEllipse(
    (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 255, 255, 255))),
    $dotX + ($dotSize * 0.55),
    $dotY + ($dotSize * 0.22),
    $highlightSize,
    $highlightSize
  )

  $accentBrush.Dispose()
  $whiteBrush.Dispose()
  $strokePen.Dispose()
  $glowBrush.Dispose()
  $glowPath.Dispose()
  $backgroundBrush.Dispose()
  $topBarPath.Dispose()
  $stemPath.Dispose()
  $surfacePath.Dispose()
  $graphics.Dispose()

  return $bitmap
}

function Save-PngIcon {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [string]$Path
  )

  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null
  $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Save-IcoIcon {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [string]$Path
  )

  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Force -Path $directory | Out-Null

  $pngStream = New-Object System.IO.MemoryStream
  $Bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes = $pngStream.ToArray()
  $pngStream.Dispose()

  $iconStream = New-Object System.IO.MemoryStream
  $writer = New-Object System.IO.BinaryWriter($iconStream)

  $writer.Write([UInt16]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]1)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([byte]0)
  $writer.Write([UInt16]1)
  $writer.Write([UInt16]32)
  $writer.Write([UInt32]$pngBytes.Length)
  $writer.Write([UInt32]22)
  $writer.Write($pngBytes)
  [System.IO.File]::WriteAllBytes($Path, $iconStream.ToArray())

  $writer.Dispose()
  $iconStream.Dispose()
}

$previewBitmap = New-BrandBitmap -Size $PreviewSize
$iconBitmap = New-BrandBitmap -Size $IconSize

Save-PngIcon -Bitmap $previewBitmap -Path $OutputPng
Save-IcoIcon -Bitmap $iconBitmap -Path $OutputIco

$previewBitmap.Dispose()
$iconBitmap.Dispose()

Write-Host "Generated brand assets:"
Write-Host "  PNG: $OutputPng"
Write-Host "  ICO: $OutputIco"
