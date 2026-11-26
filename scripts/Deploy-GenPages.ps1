# Builds the generative pages (src/GenPages) and uploads them to the Default User Settings model-driven app.
# Each page is found by name (pages.json), so a rerun updates the same pages. Then the pages are added to the solution
# and Deploy-App.ps1 rebuilds the sitemap, which lists the pages under "Settings manager".
param(
  [string]$Org = $env:DUS_ORG_URL,
  [string]$Solution = 'DefaultUserSettings',
  [switch]$SkipApp,
  [string]$Root = "$PSScriptRoot\.."
)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
$api = "$Org/api/data/v9.2"
$tok = az account get-access-token --resource $Org --query accessToken -o tsv
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/json'; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0' }
function Get-Dv($path) { $r = Invoke-RestMethod -Headers $H -Uri "$api/$path"; if ($r.PSObject.Properties.Name -contains 'value') { $r.value } else { $r } }

$gp = Join-Path $Root 'src\GenPages'
Push-Location $gp
try {
  if (-not (Test-Path 'node_modules')) { npm ci --no-audit --no-fund; if ($LASTEXITCODE) { throw 'npm ci failed' } }
  npm run --silent check
  if ($LASTEXITCODE) { throw 'page build or type check failed' }
} finally { Pop-Location }

$appId = @(Get-Dv "appmodules?`$select=appmoduleid&`$filter=uniquename eq 'jhrb_DefaultUserSettings'")[0].appmoduleid
if (-not $appId -and (Test-Path "$Root\schema\app.local.json")) { $appId = (Get-Content "$Root\schema\app.local.json" -Raw | ConvertFrom-Json).appId }
if (-not $appId) { throw 'App jhrb_DefaultUserSettings not found: run Deploy-App.ps1 first.' }

$manifest = Get-Content "$gp\pages.json" -Raw | ConvertFrom-Json
foreach ($p in $manifest.pages) {
  $existing = @(Get-Dv "uxagentprojects?`$select=uxagentprojectid&`$filter=name eq '$($p.name -replace "'", "''")'")[0]
  $pacArgs = @('model', 'genpage', 'upload', '--environment', $Org, '--app-id', $appId, '--name', $p.name,
    '--code-file', "$gp\dist\$($p.key).tsx", '--data-sources', ($p.dataSources -join ','),
    '--prompt', "Hand-written page; source in src/GenPages ($($p.file)), built by build.mjs.", '--agent-message', 'Deployed by scripts/Deploy-GenPages.ps1.', '--model', 'hand-written')
  if ($p.actions.Count) { $pacArgs += @('--actions', "$gp\dist\$($p.key).actions.json") }
  if ($existing) { $pacArgs += @('--page-id', $existing.uxagentprojectid) }
  # Windows PowerShell turns a native command's stderr into errors; pac writes progress there.
  $ErrorActionPreference = 'Continue'
  $out = & pac @pacArgs 2>&1 | Out-String
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -or $out -notmatch 'Successfully pushed page') { throw "upload of $($p.name) failed:`n$out" }
  $id = if ($existing) { $existing.uxagentprojectid } else { [regex]::Match($out, 'Page ID:\s*([0-9a-fA-F-]{36})').Groups[1].Value }
  "  page $(if ($existing) { 'updated' } else { 'created' }): $($p.name) ($id)"
  $body = @{ ComponentId = $id; ComponentType = 11685; SolutionUniqueName = $Solution; AddRequiredComponents = $false; DoNotIncludeSubcomponents = $false } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Headers $H -Uri "$api/AddSolutionComponent" -ContentType 'application/json' -Body $body | Out-Null
}
"  pages added to solution $Solution"

if (-not $SkipApp) { & "$PSScriptRoot\Deploy-App.ps1" -Org $Org -Solution $Solution -Root $Root }
