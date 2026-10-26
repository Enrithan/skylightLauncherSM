# Draws Skylight's app icon (512x423, the size Samsung TVs use): a golden-hour sky with the sun
# setting over a dark room, matching the home screen itself.
param([string]$Out = (Join-Path $PSScriptRoot '..\skylight\icon.png'))
Add-Type -AssemblyName System.Drawing

function Color([string]$hex, [int]$alpha = 255) {
  $c = [System.Drawing.ColorTranslator]::FromHtml($hex)
  [System.Drawing.Color]::FromArgb($alpha, $c.R, $c.G, $c.B)
}

$w = 512; $h = 423
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

# Sky down to the horizon, then the room.
$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$sky = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, (Color '#000000'), (Color '#000000'), 90
$blend = New-Object System.Drawing.Drawing2D.ColorBlend 5
$blend.Colors = @((Color '#221b42'), (Color '#73405a'), (Color '#f0a35e'), (Color '#140c0d'), (Color '#0c0809'))
$blend.Positions = [single[]]@(0, 0.36, 0.62, 0.8, 1)
$sky.InterpolationColors = $blend
$g.FillRectangle($sky, $rect)

# Glow around the sun, then the sun itself.
$cx = 330; $cy = 236
foreach ($ring in @(@(150, 34), @(105, 52), @(78, 80))) {
  $r = $ring[0]
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse($cx - $r, $cy - $r, 2 * $r, 2 * $r)
  $glow = New-Object System.Drawing.Drawing2D.PathGradientBrush $path
  $glow.CenterColor = Color '#ffd28a' $ring[1]
  $glow.SurroundColors = @((Color '#ffd28a' 0))
  $g.FillPath($glow, $path)
}
$sun = New-Object System.Drawing.Drawing2D.GraphicsPath
$sun.AddEllipse($cx - 46, $cy - 46, 92, 92)
$disc = New-Object System.Drawing.Drawing2D.PathGradientBrush $sun
$disc.CenterColor = Color '#fffaf0'
$disc.SurroundColors = @((Color '#ffc879'))
$g.FillPath($disc, $sun)

# The room's floor line crosses in front of the sun's lower edge.
$floor = New-Object System.Drawing.Drawing2D.LinearGradientBrush (New-Object System.Drawing.Rectangle 0, 268, $w, 155), (Color '#1a1012'), (Color '#0c0809'), 90
$g.FillRectangle($floor, 0, 268, $w, 155)

$bmp.Save((Resolve-Path -LiteralPath (Split-Path $Out)).Path + '\' + (Split-Path $Out -Leaf), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"wrote $Out"
