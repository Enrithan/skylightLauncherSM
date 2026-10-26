# Packages the skylight folder into an unsigned Tizen widget (dist\Skylight.wgt).
# Zip entries must use forward slashes, which Compress-Archive on Windows PowerShell doesn't do.
param([string]$Source = (Join-Path $PSScriptRoot '..\skylight'), [string]$Out = (Join-Path $PSScriptRoot '..\dist\Skylight.wgt'))
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$src = (Resolve-Path -LiteralPath $Source).Path
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
$out = Join-Path (Resolve-Path -LiteralPath (Split-Path $Out)).Path (Split-Path $Out -Leaf)
if (Test-Path $out) { Remove-Item $out }

$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $src -Recurse -File | ForEach-Object {
    $entry = $_.FullName.Substring($src.Length + 1).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal)
  }
} finally { $zip.Dispose() }

$z = [System.IO.Compression.ZipFile]::OpenRead($out)
$z.Entries | ForEach-Object { '  {0,8}  {1}' -f $_.Length, $_.FullName }
$z.Dispose()
"built $out ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"
