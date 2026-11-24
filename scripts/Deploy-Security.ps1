# Creates the two security roles in the solution (plan 5.6). Both are additive: assign them together with a base
# role such as Basic User. Idempotent.
#   Default User Settings Admin : full access (organization depth) to all jhrb tables; can run jhrb_ApplyDefaults / jhrb_ReconcileSettings
#   Default User Settings Reader: read profiles and scopes (lets the UI show which settings are managed) and run jhrb_ResolveEffectiveSettings
param(
  [string]$Org = $env:DUS_ORG_URL,
  [string]$Solution = 'DefaultUserSettings'
)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
$api = "$Org/api/data/v9.2"
$tok = az account get-access-token --resource $Org --query accessToken -o tsv
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/json'; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0' }
function Get-Dv($path) { (Invoke-RestMethod -Headers $H -Uri "$api/$path").value }
function Send-Dv($method, $path, $body) {
  $h = $H.Clone(); $h['MSCRM.SolutionUniqueName'] = $Solution; $h['Prefer'] = 'return=representation'
  try { Invoke-RestMethod -Method $method -Headers $h -Uri "$api/$path" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 10))) }
  catch { throw "$method $path failed: $($_.ErrorDetails.Message)" }
}
$root = @(Get-Dv "businessunits?`$select=businessunitid&`$filter=_parentbusinessunitid_value eq null")[0].businessunitid
$tables = 'jhrb_SettingsProfile', 'jhrb_ProfileScope', 'jhrb_SettingsLog', 'jhrb_RolloutJob', 'jhrb_UserState', 'jhrb_Heartbeat'  # schema names: privilege names use them

function Privileges($names) {
  $filter = ($names | % { "name eq '$_'" }) -join ' or '
  Get-Dv "privileges?`$select=privilegeid,name&`$filter=$filter"
}
function Ensure-Role($name, $description, $privilegeNames) {
  $role = @(Get-Dv "roles?`$select=roleid&`$filter=name eq '$name' and _businessunitid_value eq $root")[0]
  if (-not $role) { $role = Send-Dv Post 'roles' @{ name = $name; description = $description; 'businessunitid@odata.bind' = "/businessunits($root)" }; Write-Host "role created: $name" }
  $privs = @(Privileges $privilegeNames)
  $missing = $privilegeNames | ? { $_ -notin $privs.name }
  if ($missing) { Write-Host "  (not found, skipped: $($missing -join ', '))" }
  Invoke-RestMethod -Method Post -Headers $H -Uri "$api/roles($($role.roleid))/Microsoft.Dynamics.CRM.AddPrivilegesRole" -ContentType 'application/json' `
    -Body (@{ Privileges = @($privs | % { @{ '@odata.type' = 'Microsoft.Dynamics.CRM.RolePrivilege'; PrivilegeId = $_.privilegeid; Depth = 'Global'; BusinessUnitId = $root } }) } | ConvertTo-Json -Depth 5) | Out-Null
  Write-Host "  $($privs.Count) privileges set on $name"
  $role.roleid
}

$adminPrivs = foreach ($t in $tables) { foreach ($p in 'Create', 'Read', 'Write', 'Delete', 'Append', 'AppendTo', 'Assign', 'Share') { "prv$p$t" } }
$adminPrivs += 'prvReadUser', 'prvReadTeam', 'prvReadBusinessUnit', 'prvReadTransactionCurrency', 'prvReadSolution'
$readerPrivs = 'prvReadjhrb_SettingsProfile', 'prvReadjhrb_ProfileScope'

$adminId = Ensure-Role 'Default User Settings Admin' 'Manage default user settings: profiles, scopes, rollout jobs, logs. Additive to a base role.' $adminPrivs
$readerId = Ensure-Role 'Default User Settings Reader' 'Read default user settings profiles and scopes. Additive to a base role.' $readerPrivs
@{ admin = $adminId; reader = $readerId } | ConvertTo-Json | Set-Content "$PSScriptRoot\..\schema\roles.local.json" -Encoding utf8
"done"
