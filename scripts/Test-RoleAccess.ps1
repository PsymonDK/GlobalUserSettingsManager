# Replays what the admin pages (src/GenPages) read, write and call, as another user through Web API impersonation
# (MSCRMCallerID), to check that a role assignment is enough without System Administrator. It does not render pages.
# The caller needs prvActOnBehalfOfAnotherUser (System Administrator has it). Targets only the caller's own settings:
# the dry run, Load current values and the test group's jobs touch the pilot team, which must contain only the caller.
# Everything the test creates is deleted again.
param(
  [Parameter(Mandatory)] [guid]$AsUser,
  [string]$Org = $env:DUS_ORG_URL
)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
$api = "$Org/api/data/v9.2"
$tok = az account get-access-token --resource $Org --query accessToken -o tsv
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/json'; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0' }
function Dv([string]$Method = 'Get', [string]$Path, $Body, [switch]$As) {
  $h = $H.Clone(); if ($As) { $h.MSCRMCallerID = "$AsUser" }
  if ($Method -eq 'Post') { $h.Prefer = 'return=representation' }
  $p = @{ Method = $Method; Headers = $h; Uri = "$api/$Path" }
  if ($Body) { $p.ContentType = 'application/json; charset=utf-8'; $p.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 5)) }
  try { $r = Invoke-RestMethod @p; if ($null -eq $r) { [pscustomobject]@{} } else { $r } }
  catch { $m = $_.ErrorDetails.Message; try { $m = ($m | ConvertFrom-Json).error.message } catch {}; if (-not $m) { $m = $_.Exception.Message }; [pscustomobject]@{ DvError = $m } }
}
$results = New-Object System.Collections.ArrayList
function Check($id, $name, $r, [scriptblock]$detail = { '' }) {
  $ok = -not $r.DvError; $d = if ($ok) { & $detail } else { $r.DvError }
  [void]$results.Add([pscustomobject]@{ Id = $id; Test = $name; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Detail = "$d" })
  "{0} {1}: {2} {3}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $id, $name, $d
}
function Bind($table, $id) { "/$table($id)" }

$me = (Dv -Path 'WhoAmI').UserId
$settings = Get-Content "$PSScriptRoot\..\schema\settings.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$modeCols = $settings.modeColumn
$valueCols = $settings | % { if ($_.kind -eq 'Lookup') { "_$($_.valueColumn)_value" } else { $_.valueColumn } }
$global = @((Dv -Path "jhrb_settingsprofiles?`$select=jhrb_settingsprofileid,_jhrb_pilotteam_value&`$filter=jhrb_type eq 632490000 and statecode eq 0").value)[0]
$pilot = $global._jhrb_pilotteam_value
if (-not $pilot) { throw 'The Global row must have a pilot team' }
$members = @((Dv -Path "teammemberships?`$select=systemuserid&`$filter=teamid eq $pilot").value)
if ($members.Count -ne 1 -or $members[0].systemuserid -ne $me) { throw 'The pilot team must contain only the caller' }
$roles = (Dv -Path "systemusers($AsUser)/systemuserroles_association?`$select=name").value.name
"Impersonating $AsUser with roles: $($roles -join ', ')"
if ($roles -contains 'System Administrator') { throw 'The impersonated user has System Administrator; nothing to test' }

# --- reads ---------------------------------------------------------------------------------------------------------
$interactive = 'isdisabled eq false and accessmode eq 0 and applicationid eq null'
$r = Dv -As -Path "systemusers?`$select=systemuserid,fullname,title,internalemailaddress,_businessunitid_value,isdisabled,islicensed&`$filter=$interactive&`$orderby=fullname asc&`$top=25"; Check R2 'User search' $r { "$($r.value.Count) rows" }
$r = Dv -As -Path "systemusers($me)?`$select=systemuserid,fullname,_businessunitid_value"; Check R3 'Retrieve a user' $r { 'ok' }
$r = Dv -As -Path "systemusers?`$select=systemuserid&`$filter=isdisabled eq false and teammembership_association/any(t:t/teamid eq $pilot)"; Check R4 'Pilot team members (lambda filter)' $r { "$($r.value.Count)" }
$r = Dv -As -Path "teams?`$select=teamid,name&`$orderby=name asc&`$top=25"; Check R5 'Team search' $r { "$($r.value.Count) rows" }
$r = Dv -As -Path "businessunits?`$select=businessunitid,name&`$orderby=name asc&`$top=25"; Check R6 'Business unit search' $r { "$($r.value.Count) rows" }
$r = Dv -As -Path "usersettingscollection?`$select=$((($settings.attribute) + 'systemuserid') -join ',')&`$filter=systemuserid eq $me"; Check R7 "Another user's usersettings" $r { "$($r.value.Count) row" }
$r = Dv -As -Path "jhrb_settingsprofiles?`$select=jhrb_settingsprofileid,jhrb_name,jhrb_type,_jhrb_pilotteam_value,$($modeCols -join ',')&`$filter=statecode eq 0"; Check R8 'Profiles with mode columns' $r { "$($r.value.Count) rows" }
$r = Dv -As -Path "jhrb_settingsprofiles($($global.jhrb_settingsprofileid))?`$select=$(($modeCols + $valueCols) -join ',')"; Check R9 'Global profile with value columns' $r { 'ok' }
$r = Dv -As -Path "jhrb_profilescopes?`$select=jhrb_profilescopeid,jhrb_scopetype,_jhrb_team_value,_jhrb_businessunit_value,_jhrb_profile_value,jhrb_includechildbu&`$filter=statecode eq 0"; Check R10 'Scopes' $r { "$($r.value.Count) rows" }
$r = Dv -As -Path "jhrb_rolloutjobs?`$select=jhrb_rolloutjobid,jhrb_status&`$orderby=createdon desc&`$top=50"; Check R11 'Rollout jobs' $r { "$($r.value.Count) rows" }
$r = Dv -As -Path "jhrb_settingslogs?`$select=jhrb_settingslogid,jhrb_setting,jhrb_source,_jhrb_user_value,_jhrb_profile_value,createdon&`$orderby=createdon desc&`$top=100"; Check R12 'Activity log (elastic)' $r { "$($r.value.Count) rows" }
$r = Dv -As -Path "uxagentprojects?`$select=uxagentprojectid,name&`$filter=startswith(name,'Default User Settings - ')"; Check R13 'Page lookup by name (uxagentproject)' $r { "$($r.value.Count) pages" }
$r = Dv -As -Path "uxagentprojectfiles?`$select=uxagentprojectfileid&`$top=1"; Check R14 'Page files (uxagentprojectfile)' $r { "$($r.value.Count) row" }
$r = Dv -As -Path "appmodules?`$select=appmoduleid&`$filter=uniquename eq 'jhrb_DefaultUserSettings'"; Check R15 'App module' $r { "$($r.value.Count) row" }

# --- Custom APIs ---------------------------------------------------------------------------------------------------
$created = New-Object System.Collections.ArrayList
$r = Dv -As Post 'jhrb_ResolveEffectiveSettings' @{ UserId = "$me" }; Check A1 'jhrb_ResolveEffectiveSettings' $r { "inScope=$($r.InScope)" }
$r = Dv -As Post 'jhrb_ApplyDefaults' @{ Scope = 'User'; UserId = "$me"; DryRun = $true; ApplyMode = 'Full' }; Check A2 'jhrb_ApplyDefaults (dry run, own user)' $r { "updated=$($r.Updated) unchanged=$($r.Unchanged) failed=$($r.Failed)" }
$r = Dv -As Post 'jhrb_ReconcileSettings' @{}; Check A3 'jhrb_ReconcileSettings' $r { "job=$([bool]$r.JobId)" }
$override = @((Dv -Path "jhrb_settingsprofiles?`$select=jhrb_settingsprofileid&`$filter=jhrb_type eq 632490002 and _jhrb_user_value eq $me").value)[0].jhrb_settingsprofileid
if ($override) { $r = Dv -As Post 'jhrb_LoadCurrentSettings' @{ ProfileId = "$override"; UserId = "$me"; OverwriteManaged = $false }; Check A4 'jhrb_LoadCurrentSettings (own override)' $r { "loaded=$($r.Loaded) keptManaged=$($r.KeptManaged)" } }

# --- writes (test group, removed again) ----------------------------------------------------------------------------
$r = Dv -As Post 'jhrb_settingsprofiles' @{ jhrb_name = 'DUS Role access test'; jhrb_type = 632490001; jhrb_priority = 1; jhrb_isactive = $true }
# WhoAmI ignores MSCRMCallerID, so the created row's owner shows that impersonation took effect.
Check W1 'Create group profile (created by the impersonated user)' $r { if ($r._createdby_value -eq "$AsUser") { 'ok' } else { throw "created by $($r._createdby_value)" } }; $gp = $r.jhrb_settingsprofileid
if ($gp) {
  $r = Dv -As Patch "jhrb_settingsprofiles($gp)" @{ jhrb_priority = 2 }; Check W2 'Update profile' $r { 'ok' }
  $r = Dv -As Post 'jhrb_profilescopes' @{ jhrb_name = 'DUS Role access test'; jhrb_scopetype = 632490000; jhrb_includechildbu = $false; 'jhrb_Profile@odata.bind' = (Bind jhrb_settingsprofiles $gp); 'jhrb_Team@odata.bind' = (Bind teams $pilot) }
  Check W3 'Add team scope' $r { 'ok' }
  if ($r.jhrb_profilescopeid) { $r = Dv -As Delete "jhrb_profilescopes($($r.jhrb_profilescopeid))"; Check W4 'Remove scope' $r { 'ok' } }
  # Wait for the four jobs (create, update, scope add, scope remove) to be queued and finished: deleting a profile while
  # an async change plugin still inserts a job that references it fails with a SQL constraint (see test results).
  $deadline = (Get-Date).AddSeconds(180)
  do { Start-Sleep -Seconds 5; $jobs = @((Dv -Path "jhrb_rolloutjobs?`$select=jhrb_status&`$filter=_jhrb_profile_value eq $gp").value) }
  while ((Get-Date) -lt $deadline -and ($jobs.Count -lt 4 -or @($jobs | ? { $_.jhrb_status -in 632490000, 632490001 }).Count))
  $r = Dv -As Delete "jhrb_settingsprofiles($gp)"; Check W5 'Delete group profile' $r { 'ok' }
  if ($r.DvError) { Dv Delete "jhrb_settingsprofiles($gp)" | Out-Null }
}
$job = @((Dv -As -Path "jhrb_rolloutjobs?`$select=jhrb_rolloutjobid&`$filter=_createdby_value eq $AsUser&`$orderby=createdon desc&`$top=1").value)[0]
if ($job) { $r = Dv -As Patch "jhrb_rolloutjobs($($job.jhrb_rolloutjobid))" @{ jhrb_status = 632490004 }; Check W6 'Cancel a rollout job' $r { 'ok' } }

$fail = @($results | ? Result -eq 'FAIL').Count
"`n$($results.Count - $fail) passed, $fail failed"
$results
