# Registers/updates the plugin assembly, types and steps inside the DefaultUserSettings solution. Idempotent.
param(
  [string]$Org = $env:DUS_ORG_URL,
  [string]$Solution = 'DefaultUserSettings',
  [string]$Dll = "$PSScriptRoot\..\src\DefaultUserSettings.Plugins\bin\Release\net462\DefaultUserSettings.Plugins.dll"
)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
$api = "$Org/api/data/v9.2"
$tok = az account get-access-token --resource $Org --query accessToken -o tsv
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/json'; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0' }
function Get-Dv($path) { (Invoke-RestMethod -Headers $H -Uri "$api/$path").value }
function Send-Dv($method, $path, $body, [switch]$NoRepresentation) {
  $h = $H.Clone(); $h['MSCRM.SolutionUniqueName'] = $Solution
  # Custom API tables reject Prefer: return=representation (405); callers re-query instead.
  if (-not $NoRepresentation -and $method -eq 'Post') { $h['Prefer'] = 'return=representation' }
  try { Invoke-RestMethod -Method $method -Headers $h -Uri "$api/$path" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 10))) }
  catch { throw "$method $path failed: $($_.ErrorDetails.Message) $($_.Exception.Message)" }
}

$settings = Get-Content "$PSScriptRoot\..\schema\settings.json" -Raw | ConvertFrom-Json
$filtering = ($settings.attribute) -join ','

# Assembly
$content = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Resolve-Path $Dll)))
$asm = @(Get-Dv "pluginassemblies?`$select=pluginassemblyid&`$filter=name eq 'DefaultUserSettings.Plugins'")[0]
if ($asm) { $asmId = $asm.pluginassemblyid; Send-Dv Patch "pluginassemblies($asmId)" @{ content = $content } | Out-Null; "assembly updated" }
else { $asmId = (Send-Dv Post 'pluginassemblies' @{ name = 'DefaultUserSettings.Plugins'; content = $content; isolationmode = 2; sourcetype = 0 }).pluginassemblyid; "assembly created" }

function Get-Type($typeName) {
  $t = @(Get-Dv "plugintypes?`$select=plugintypeid&`$filter=typename eq '$typeName'")[0]
  if ($t) { return $t.plugintypeid }
  (Send-Dv Post 'plugintypes' @{ typename = $typeName; name = $typeName; friendlyname = $typeName.Split('.')[-1]; 'pluginassemblyid@odata.bind' = "/pluginassemblies($asmId)" }).plugintypeid
}
function Msg($name) { @(Get-Dv "sdkmessages?`$select=sdkmessageid&`$filter=name eq '$name'")[0].sdkmessageid }
function MsgFilter($msgId, $entity) {
  $f = @(Get-Dv "sdkmessagefilters?`$select=sdkmessagefilterid&`$filter=_sdkmessageid_value eq $msgId and primaryobjecttypecode eq '$entity'")[0]
  if (-not $f) { throw "No message filter for $entity (is the table published?)" }
  $f.sdkmessagefilterid
}
function Step($name, $typeId, $message, $entity, $stage, $mode, $filteringAttributes, [switch]$PreImage, [switch]$PostImage) {
  $msgId = Msg $message
  $body = @{
    name = $name; stage = $stage; mode = $mode; rank = 1; supporteddeployment = 0; invocationsource = 0; asyncautodelete = ($mode -eq 1)
    'plugintypeid@odata.bind' = "/plugintypes($typeId)"; 'sdkmessageid@odata.bind' = "/sdkmessages($msgId)"
    'sdkmessagefilterid@odata.bind' = "/sdkmessagefilters($(MsgFilter $msgId $entity))"
  }
  if ($filteringAttributes) { $body.filteringattributes = $filteringAttributes }
  $existing = @(Get-Dv "sdkmessageprocessingsteps?`$select=sdkmessageprocessingstepid&`$filter=name eq '$name'")[0]
  if ($existing) { $id = $existing.sdkmessageprocessingstepid; Send-Dv Patch "sdkmessageprocessingsteps($id)" $body | Out-Null; "  step updated: $name" }
  else { $id = (Send-Dv Post 'sdkmessageprocessingsteps' $body).sdkmessageprocessingstepid; "  step created: $name" }
  $images = @()
  if ($PreImage) { $images += @{ alias = 'PreImage'; type = 0 } }
  if ($PostImage) { $images += @{ alias = 'PostImage'; type = 1 } }
  foreach ($img in $images) {
    if (-not (Get-Dv "sdkmessageprocessingstepimages?`$select=name&`$filter=_sdkmessageprocessingstepid_value eq $id and entityalias eq '$($img.alias)'")) {
      $prop = if ($message -eq 'Create') { 'Id' } else { 'Target' }
      Send-Dv Post 'sdkmessageprocessingstepimages' @{ name = $img.alias; entityalias = $img.alias; imagetype = $img.type; messagepropertyname = $prop
        'sdkmessageprocessingstepid@odata.bind' = "/sdkmessageprocessingsteps($id)" } | Out-Null
      "    + $($img.alias)"
    }
  }
}

function Ensure-CustomApi($unique, $display, $description, $typeId, $privilege, $requests, $responses) {
  $capi = @(Get-Dv "customapis?`$select=customapiid&`$filter=uniquename eq '$unique'")[0]
  if ($capi) { $apiId = $capi.customapiid; "  custom API exists: $unique" }
  else {
    Send-Dv Post 'customapis' -NoRepresentation @{ uniquename = $unique; name = $unique; displayname = $display; description = $description
      bindingtype = 0; isfunction = $false; isprivate = $false; allowedcustomprocessingsteptype = 0; executeprivilegename = $privilege
      'PluginTypeId@odata.bind' = "/plugintypes($typeId)" } | Out-Null
    $apiId = @(Get-Dv "customapis?`$select=customapiid&`$filter=uniquename eq '$unique'")[0].customapiid
    "  custom API created: $unique"
  }
  foreach ($r in $requests) {
    $u = $r.name  # uniquename IS the parameter name the caller uses
    if (-not (Get-Dv "customapirequestparameters?`$select=uniquename&`$filter=_customapiid_value eq $apiId and uniquename eq '$u'")) {
      Send-Dv Post 'customapirequestparameters' -NoRepresentation @{ uniquename = $u; name = $r.name; displayname = $r.name; description = $r.desc; type = $r.type; isoptional = $true
        'CustomAPIId@odata.bind' = "/customapis($apiId)" } | Out-Null
      "    + in  $($r.name)"
    }
  }
  foreach ($r in $responses) {
    $u = $r.name  # uniquename IS the parameter name the caller uses
    if (-not (Get-Dv "customapiresponseproperties?`$select=uniquename&`$filter=_customapiid_value eq $apiId and uniquename eq '$u'")) {
      Send-Dv Post 'customapiresponseproperties' -NoRepresentation @{ uniquename = $u; name = $r.name; displayname = $r.name; description = $r.desc; type = $r.type
        'CustomAPIId@odata.bind' = "/customapis($apiId)" } | Out-Null
      "    + out $($r.name)"
    }
  }
}

$ns = 'DefaultUserSettings.Plugins.Plugins'
$lock = Get-Type "$ns.LockEnforcementPlugin"
$pv   = Get-Type "$ns.ProfileValidationPlugin"
$sv   = Get-Type "$ns.ScopeValidationPlugin"
$job  = Get-Type "$ns.RolloutJobPlugin"
$pc   = Get-Type "$ns.ProfileChangePlugin"
$sc   = Get-Type "$ns.ScopeChangePlugin"
$mem  = Get-Type "$ns.MembershipChangePlugin"
$nu   = Get-Type "$ns.NewUserPlugin"
$hb   = Get-Type "$ns.HeartbeatPlugin"
$apply = Get-Type "$ns.ApplyDefaultsApi"
$rec   = Get-Type "$ns.ReconcileSettingsApi"
$res   = Get-Type "$ns.ResolveEffectiveSettingsApi"

# Stage 10 = PreValidation, 20 = PreOperation, 40 = PostOperation. Mode 0 = sync, 1 = async.
Step 'DUS: Enforce locks (usersettings Update, Pre)' $lock 'Update' 'usersettings' 20 0 $filtering
Step 'DUS: Validate profile (Create)' $pv 'Create' 'jhrb_settingsprofile' 10 0 $null
Step 'DUS: Validate profile (Update)' $pv 'Update' 'jhrb_settingsprofile' 10 0 $null -PreImage
Step 'DUS: Validate scope (Create)'   $sv 'Create' 'jhrb_profilescope' 10 0 $null
Step 'DUS: Validate scope (Update)'   $sv 'Update' 'jhrb_profilescope' 10 0 $null -PreImage
Step 'DUS: Process rollout job (Create)'   $job 'Create' 'jhrb_rolloutjob' 40 1 $null
Step 'DUS: Process rollout job (Continue)' $job 'Update' 'jhrb_rolloutjob' 40 1 'jhrb_continue'
Step 'DUS: Profile changed (Create)' $pc 'Create' 'jhrb_settingsprofile' 40 1 $null -PostImage
Step 'DUS: Profile changed (Update)' $pc 'Update' 'jhrb_settingsprofile' 40 1 $null -PreImage -PostImage
Step 'DUS: Profile changed (Delete)' $pc 'Delete' 'jhrb_settingsprofile' 40 1 $null -PreImage
Step 'DUS: Scope changed (Create)' $sc 'Create' 'jhrb_profilescope' 40 1 $null -PostImage
Step 'DUS: Scope changed (Update)' $sc 'Update' 'jhrb_profilescope' 40 1 $null -PreImage -PostImage
Step 'DUS: Scope changed (Delete)' $sc 'Delete' 'jhrb_profilescope' 40 1 $null -PreImage
Step 'DUS: Team membership (Associate)'    $mem 'Associate' 'none' 40 0 $null
Step 'DUS: Team membership (Disassociate)' $mem 'Disassociate' 'none' 40 0 $null
Step 'DUS: Business unit change (systemuser Update)' $mem 'Update' 'systemuser' 40 0 'businessunitid'
Step 'DUS: New user (systemuser Create)' $nu 'Create' 'systemuser' 40 0 $null
Step 'DUS: Heartbeat (Delete)' $hb 'Delete' 'jhrb_heartbeat' 40 1 $null

# Custom API parameter types: 0 Boolean, 7 Integer, 10 String, 12 Guid
Ensure-CustomApi 'jhrb_ApplyDefaults' 'Apply Default User Settings' 'Apply effective settings to one user (inline) or all users (queues a rollout job).' $apply 'prvCreatejhrb_RolloutJob' @(
  @{ name = 'Scope'; type = 10; desc = 'All (default) or User.' }, @{ name = 'UserId'; type = 12; desc = 'User for Scope=User (default: caller).' },
  @{ name = 'Setting'; type = 10; desc = 'Comma-separated usersettings attributes; empty = all.' }, @{ name = 'DryRun'; type = 0; desc = 'Count differences only.' },
  @{ name = 'ApplyMode'; type = 10; desc = 'Full (default), LockedOnly or Auto.' }, @{ name = 'IgnorePilot'; type = 0; desc = 'Dry runs only: ignore the pilot team.' },
  @{ name = 'BatchSize'; type = 7; desc = 'Users per page (default 200).' }, @{ name = 'ChunkSeconds'; type = 7; desc = 'Time budget per execution (default 90).' }) @(
  @{ name = 'JobId'; type = 12; desc = 'Rollout job (empty for Scope=User).' }, @{ name = 'Updated'; type = 7; desc = 'Users with changes (Scope=User).' },
  @{ name = 'Unchanged'; type = 7; desc = 'Users without changes (Scope=User).' }, @{ name = 'Failed'; type = 7; desc = 'Failures (Scope=User).' })
Ensure-CustomApi 'jhrb_ReconcileSettings' 'Reconcile User Settings' 'Queue the reconcile (Auto apply for all users) and resume stalled jobs.' $rec 'prvCreatejhrb_RolloutJob' @() @(
  @{ name = 'JobId'; type = 12; desc = 'Reconcile job.' })
Ensure-CustomApi 'jhrb_ResolveEffectiveSettings' 'Resolve Effective User Settings' 'Effective value, mode and winning profile per managed setting for a user.' $res 'prvReadjhrb_SettingsProfile' @(
  @{ name = 'UserId'; type = 12; desc = 'User (default: caller).' }) @(
  @{ name = 'Settings'; type = 10; desc = 'JSON array.' }, @{ name = 'Layers'; type = 10; desc = 'JSON array of profile names, highest precedence first.' },
  @{ name = 'InScope'; type = 0; desc = 'User is in scope (active Global row and pilot team, if set).' })
"done"
