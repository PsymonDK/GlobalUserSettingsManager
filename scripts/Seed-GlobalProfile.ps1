# Creates the Global profile (all settings Inherit = nothing managed) and, optionally, a pilot team so that
# enforcement only applies to its members. Idempotent.
param(
  [string]$Org = $env:DUS_ORG_URL,
  [string]$PilotTeamName = 'DUS Pilot',
  [Guid[]]$PilotMembers = @(),
  [switch]$NoPilot
)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
$api = "$Org/api/data/v9.2"
$tok = az account get-access-token --resource $Org --query accessToken -o tsv
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/json'; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0'; Prefer = 'return=representation' }
function Get-Dv($path) { (Invoke-RestMethod -Headers $H -Uri "$api/$path").value }
function Post-Dv($path, $body) { Invoke-RestMethod -Method Post -Headers $H -Uri "$api/$path" -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 5) }

$teamId = $null
if (-not $NoPilot) {
  $team = @(Get-Dv "teams?`$select=teamid&`$filter=name eq '$PilotTeamName'")[0]
  if (-not $team) {
    $whoami = Invoke-RestMethod -Headers $H -Uri "$api/WhoAmI"
    $team = Post-Dv 'teams' @{ name = $PilotTeamName; teamtype = 0; description = 'Default User Settings pilot: only members are enforced and rolled out.'
      'businessunitid@odata.bind' = "/businessunits($($whoami.BusinessUnitId))"; 'administratorid@odata.bind' = "/systemusers($($whoami.UserId))" }
    "pilot team created"
  }
  $teamId = $team.teamid
  foreach ($m in $PilotMembers) {
    if (-not (Get-Dv "teammemberships?`$select=systemuserid&`$filter=teamid eq $teamId and systemuserid eq $m")) {
      Post-Dv "teams($teamId)/teammembership_association/`$ref" @{ '@odata.id' = "$api/systemusers($m)" } | Out-Null
      "  + pilot member $m"
    }
  }
}

$global = @(Get-Dv "jhrb_settingsprofiles?`$select=jhrb_settingsprofileid&`$filter=jhrb_type eq 632490000")[0]
if (-not $global) {
  $body = @{ jhrb_name = 'Global'; jhrb_type = 632490000; jhrb_isactive = $true }
  if ($teamId) { $body['jhrb_PilotTeam@odata.bind'] = "/teams($teamId)" }
  $global = Post-Dv 'jhrb_settingsprofiles' $body
  "Global profile created: $($global.jhrb_settingsprofileid)"
} else { "Global profile exists: $($global.jhrb_settingsprofileid)" }
