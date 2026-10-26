# Downloads the app logos Skylight shows on its tiles and saves them as 256x256 PNGs in
# skylight\icons. The logos belong to their owners and aren't shipped with the repository, so run
# this once before building. Icons come from the public App Store listings (no account needed) and,
# for TizenTube, from its own repository.
#
#   .\fetch-icons.ps1            # all of them
#   .\fetch-icons.ps1 -Only netflix,spotify
param([string[]]$Only)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\skylight\icons'
New-Item -ItemType Directory -Force $out | Out-Null
$headers = @{ 'User-Agent' = 'skylight-fetch-icons' }

# name -> App Store search term and a pattern the listing's name must match (so a lookalike
# app never sneaks in). `country` picks the storefront whose icon you want.
$apps = [ordered]@{
  netflix     = @{ term = 'Netflix';            match = '^Netflix';         country = 'in' }
  primevideo  = @{ term = 'Amazon Prime Video'; match = '^Amazon Prime Video'; country = 'in' }
  jiohotstar  = @{ term = 'JioHotstar';         match = '^JioHotstar';      country = 'in' }
  sonyliv     = @{ term = 'Sony LIV';           match = '^Sony ?LIV';       country = 'in' }
  spotify     = @{ term = 'Spotify';            match = '^Spotify';         country = 'in' }
  youtube     = @{ term = 'YouTube';            match = '^YouTube$';        country = 'in' }
  smartthings = @{ term = 'SmartThings';        match = '^SmartThings';     country = 'in' }
}
$direct = [ordered]@{
  tizentube = 'https://raw.githubusercontent.com/reisxd/TizenTube/main/standalone/icon.png'
}

function Save-Square([string]$source, [string]$target) {
  $img = [System.Drawing.Bitmap]::FromFile($source)
  # Some icons have transparent rounded corners; fill those with the icon's own edge colour so the
  # tile's corners (rounded again by Skylight) don't show a different colour.
  $edge = $img.GetPixel([int]($img.Width * 0.06), [int]($img.Height / 2))
  if ($edge.A -lt 200) { $edge = $img.GetPixel([int]($img.Width / 2), [int]($img.Height * 0.06)) }
  $size = 256
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromArgb(255, $edge.R, $edge.G, $edge.B))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $scale = [Math]::Min($size / $img.Width, $size / $img.Height)
  $w = [int]($img.Width * $scale); $h = [int]($img.Height * $scale)
  $g.DrawImage($img, [int](($size - $w) / 2), [int](($size - $h) / 2), $w, $h)
  $bmp.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) 'skylight-icons'
New-Item -ItemType Directory -Force $tmp | Out-Null

foreach ($name in $apps.Keys) {
  if ($Only -and $Only -notcontains $name) { continue }
  $a = $apps[$name]
  $q = [Uri]::EscapeDataString($a.term)
  $r = Invoke-RestMethod -Headers $headers "https://itunes.apple.com/search?term=$q&entity=software&country=$($a.country)&limit=10"
  $hit = $r.results | Where-Object { $_.trackName -match $a.match } | Select-Object -First 1
  if (-not $hit) { Write-Warning "No App Store listing matched '$($a.term)'; skipping $name"; continue }
  $url = $hit.artworkUrl512 -replace '\.jpg$', '.png'
  $raw = Join-Path $tmp "$name.png"
  Invoke-WebRequest -UseBasicParsing -Headers $headers $url -OutFile $raw
  Save-Square $raw (Join-Path $out "$name.png")
  '{0,-12} {1}' -f $name, $hit.trackName
}
foreach ($name in $direct.Keys) {
  if ($Only -and $Only -notcontains $name) { continue }
  $raw = Join-Path $tmp "$name.png"
  Invoke-WebRequest -UseBasicParsing -Headers $headers $direct[$name] -OutFile $raw
  Save-Square $raw (Join-Path $out "$name.png")
  '{0,-12} {1}' -f $name, $direct[$name]
}
"Icons saved to $out"
