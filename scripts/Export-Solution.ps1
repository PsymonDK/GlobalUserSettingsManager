# Exports DefaultUserSettings as unmanaged + managed zips and unpacks both into solution/src (source control).
# Uses the active pac auth profile; pass -Org to target another environment.
param(
  [string]$Org = $env:DUS_ORG_URL,
  [string]$Solution = 'DefaultUserSettings',
  [string]$Out = "$PSScriptRoot\..\solution"
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
$envArg = if ($Org) { @('--environment', $Org) } else { @() }
pac solution publish @envArg
pac solution export --name $Solution --path "$Out\$Solution.zip" --overwrite @envArg
if ($LASTEXITCODE) { throw 'unmanaged export failed' }
pac solution export --name $Solution --path "$Out\$($Solution)_managed.zip" --managed --overwrite @envArg
if ($LASTEXITCODE) { throw 'managed export failed' }
if (Test-Path "$Out\src") { Remove-Item -Recurse -Force "$Out\src" }
pac solution unpack --zipfile "$Out\$Solution.zip" --folder "$Out\src" --packagetype Both --allowDelete --allowWrite
if ($LASTEXITCODE) { throw 'unpack failed' }
# The code app package carries the source environment's id; keep it out of source control (open source).
$utf8 = New-Object System.Text.UTF8Encoding($false)
Get-ChildItem "$Out\src\CanvasApps" -Recurse -Force -Filter power.config.json -ErrorAction SilentlyContinue | ForEach-Object {
  $json = [IO.File]::ReadAllText($_.FullName)
  $json = $json -replace '("environmentId"\s*:\s*)"[^"]*"', '$1"00000000-0000-0000-0000-000000000000"'
  [IO.File]::WriteAllText($_.FullName, $json, $utf8)
}
"exported to $Out"
