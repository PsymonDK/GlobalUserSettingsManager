# Phase 2-4 integration tests (rollout, jobs, membership, reconcile, Custom APIs, heartbeat) on ONE test user: the caller,
# who must be the only member of the Global row's pilot team. Restores state afterwards. Appends to docs/test-results.md.
param(
  [string]$Org = $env:DUS_ORG_URL,
  [string]$OutFile = "$PSScriptRoot\..\docs\test-results-phase2-4.md",
  [int]$JobTimeoutSec = 420
)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
$api = "$Org/api/data/v9.2"
$tok = az account get-access-token --resource $Org --query accessToken -o tsv
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/json'; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0' }
function Dv([string]$Method = 'Get', [string]$Path, $Body) {
  $h = $H.Clone(); if ($Method -eq 'Post') { $h.Prefer = 'return=representation' }
  $p = @{ Method = $Method; Headers = $h; Uri = "$api/$Path" }
  if ($Body) { $p.ContentType = 'application/json'; $p.Body = ($Body | ConvertTo-Json -Depth 5) }
  try { Invoke-RestMethod @p } catch { $m = $_.ErrorDetails.Message; if (-not $m) { $m = $_.Exception.Message }; [pscustomobject]@{ DvError = $m } }
}
$INHERIT = 632490000; $DEFAULT = 632490001; $LOCKED = 632490002
$who = Dv -Path 'WhoAmI'; $me = $who.UserId
$global = @((Dv -Path "jhrb_settingsprofiles?`$select=jhrb_settingsprofileid,_jhrb_pilotteam_value&`$filter=jhrb_type eq 632490000").value)[0]
$gid = $global.jhrb_settingsprofileid; $pilot = $global._jhrb_pilotteam_value
if (-not $pilot) { throw 'Global row must have a pilot team for this test' }
$pilotMembers = @((Dv -Path "teammemberships?`$select=systemuserid&`$filter=teamid eq $pilot").value)
if ($pilotMembers.Count -ne 1 -or $pilotMembers[0].systemuserid -ne $me) { throw 'Pilot team must contain only the caller' }
$orig = (Dv -Path "usersettingscollection($me)?`$select=paginglimit").paginglimit
$results = New-Object System.Collections.ArrayList
$cleanup = New-Object System.Collections.ArrayList
function Check($id, $name, [bool]$ok, $detail) { [void]$results.Add([pscustomobject]@{ Id = $id; Test = $name; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Detail = "$detail" }); "{0} {1}: {2} ({3})" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $id, $name, $detail }
function Paging { (Dv -Path "usersettingscollection($me)?`$select=paginglimit").paginglimit }
function SetPaging($v) { Dv -Method Patch -Path "usersettingscollection($me)" -Body @{ paginglimit = $v } | Out-Null }
function ServerNow { (Dv -Path "WhoAmI" | Out-Null); (Invoke-WebRequest -Headers $H -Uri "$api/WhoAmI" -UseBasicParsing).Headers.Date | % { [datetime]::Parse($_).ToUniversalTime() } }
function WaitJob($since, $reason, [int]$timeout = $JobTimeoutSec) {
  $s = $since.AddSeconds(-5).ToString('yyyy-MM-ddTHH:mm:ssZ'); $deadline = (Get-Date).AddSeconds($timeout)
  $f = "createdon ge $s"; if ($reason) { $f += " and jhrb_reason eq $reason" }
  while ((Get-Date) -lt $deadline) {
    $jobs = @((Dv -Path "jhrb_rolloutjobs?`$select=jhrb_name,jhrb_status,jhrb_processed,jhrb_updated,jhrb_unchanged,jhrb_failed,jhrb_chunks,jhrb_error,createdon&`$filter=$f&`$orderby=createdon desc").value)
    if ($jobs.Count -gt 0 -and -not ($jobs | ? { $_.jhrb_status -in 632490000, 632490001 })) { return $jobs }
    Start-Sleep 5
  }
  return @((Dv -Path "jhrb_rolloutjobs?`$select=jhrb_name,jhrb_status,jhrb_processed,jhrb_updated,jhrb_failed,jhrb_chunks,jhrb_error&`$filter=$f").value)
}
function Summ($jobs) { ($jobs | % { "[$($_.jhrb_name): status=$($_.jhrb_status) processed=$($_.jhrb_processed) updated=$($_.jhrb_updated) failed=$($_.jhrb_failed) chunks=$($_.jhrb_chunks)]" }) -join ' ' }
function SetGlobal($mode, $value) { Dv -Method Patch -Path "jhrb_settingsprofiles($gid)" -Body @{ jhrb_paginglimit = $value; jhrb_paginglimit_mode = $mode } | Out-Null }
function MyOverride { @((Dv -Path "jhrb_settingsprofiles?`$select=jhrb_settingsprofileid&`$filter=jhrb_type eq 632490002 and _jhrb_user_value eq $me").value) }

try {
  # Baseline: Global manages nothing; give user a non-default value.
  SetGlobal $INHERIT $null; Start-Sleep 20
  SetPaging 75

  # R1 Global value change rolls out (async ProfileChange -> job -> processor)
  $t = ServerNow; SetGlobal $DEFAULT 50
  $jobs = @(WaitJob $t 632490001)
  $v = Paging
  Check 'R1' 'Global Default change rolls out to existing users' ($v -eq 50) "paginglimit=$v $(Summ $jobs)"
  $log = @((Dv -Path "jhrb_settingslogs?`$select=jhrb_setting,jhrb_oldvalue,jhrb_appliedvalue,jhrb_source&`$filter=_jhrb_user_value eq $me and jhrb_source eq 632490000&`$orderby=createdon desc&`$top=1").value)[0]
  Check 'R1b' 'Rollout logged with old and applied value' ($log.jhrb_oldvalue -eq '75' -and $log.jhrb_appliedvalue -eq '50') "log $($log.jhrb_setting) $($log.jhrb_oldvalue)->$($log.jhrb_appliedvalue)"
  Check 'R2' 'Rollout writes are not captured as admin edits (tag works)' ((MyOverride).Count -eq 0) "override rows=$((MyOverride).Count)"

  # R3 Default stays user-editable after rollout
  SetPaging 100; $v = Paging
  Check 'R3' 'After rollout, Default setting is still user-editable' ($v -eq 100) "paginglimit=$v"

  # R4 Custom API, Scope=User inline
  $r = Dv -Method Post -Path 'jhrb_ApplyDefaults' -Body @{ Scope = 'User'; ApplyMode = 'Full' }
  $v = Paging
  Check 'R4' 'jhrb_ApplyDefaults Scope=User applies inline' ($v -eq 50 -and $r.Updated -eq 1) "paginglimit=$v response updated=$($r.Updated) $($r.DvError)"

  # R5 Reconcile (Auto) keeps the user's own Default choice when layers are unchanged
  SetPaging 100
  $t = ServerNow; $r = Dv -Method Post -Path 'jhrb_ReconcileSettings' -Body @{}
  $jobs = @(WaitJob $t 632490004); $v = Paging
  Check 'R5' 'Reconcile does not overwrite user-changed Default when layers unchanged' ($v -eq 100) "paginglimit=$v $(Summ $jobs) $($r.DvError)"

  # R6 Locking via profile change pulls user back
  $t = ServerNow; SetGlobal $LOCKED 50
  $jobs = @(WaitJob $t 632490001); $v = Paging
  Check 'R6' 'Default->Locked change pulls users to the locked value' ($v -eq 50) "paginglimit=$v $(Summ $jobs)"
  SetGlobal $DEFAULT 50; Start-Sleep 15

  # R7/R8 Membership: group scoped to a test team; Associate -> user job (Auto: layers changed -> Full)
  $team = Dv -Method Post -Path 'teams' -Body @{ name = 'DUS Test Team'; teamtype = 0; 'businessunitid@odata.bind' = "/businessunits($($who.BusinessUnitId))"; 'administratorid@odata.bind' = "/systemusers($me)" }
  [void]$cleanup.Add("teams($($team.teamid))")
  $grp = Dv -Method Post -Path 'jhrb_settingsprofiles' -Body @{ jhrb_name = 'Test team group'; jhrb_type = 632490001; jhrb_priority = 500; jhrb_paginglimit = 25; jhrb_paginglimit_mode = $DEFAULT }
  [void]$cleanup.Insert(0, "jhrb_settingsprofiles($($grp.jhrb_settingsprofileid))")
  Dv -Method Post -Path 'jhrb_profilescopes' -Body @{ jhrb_name = 'DUS Test Team'; jhrb_scopetype = 632490000; 'jhrb_Profile@odata.bind' = "/jhrb_settingsprofiles($($grp.jhrb_settingsprofileid))"; 'jhrb_Team@odata.bind' = "/teams($($team.teamid))" } | Out-Null
  Start-Sleep 20
  $t = ServerNow
  Dv -Method Post -Path "teams($($team.teamid))/teammembership_association/`$ref" -Body @{ '@odata.id' = "$api/systemusers($me)" } | Out-Null
  $jobs = @(WaitJob $t 632490003); $v = Paging
  Check 'R7' 'Joining a team applies that group''s defaults (Associate event)' ($v -eq 25) "paginglimit=$v $(Summ $jobs)"
  $t = ServerNow
  Dv -Method Delete -Path "teams($($team.teamid))/teammembership_association($me)/`$ref" | Out-Null
  $jobs = @(WaitJob $t 632490003); $v = Paging
  Check 'R8' 'Leaving the team falls back to Global defaults' ($v -eq 50) "paginglimit=$v $(Summ $jobs)"

  # R9 Unobservable membership (AddMembersTeam) picked up by reconcile via fingerprint
  Dv -Method Post -Path "teams($($team.teamid))/Microsoft.Dynamics.CRM.AddMembersTeam" -Body @{ Members = @(@{ '@odata.type' = 'Microsoft.Dynamics.CRM.systemuser'; systemuserid = $me }) } | Out-Null
  Start-Sleep 10; $v1 = Paging
  $t = ServerNow; Dv -Method Post -Path 'jhrb_ReconcileSettings' -Body @{} | Out-Null
  $jobs = @(WaitJob $t 632490004); $v = Paging
  Check 'R9' 'AddMembersTeam (no event) is picked up by reconcile' ($v1 -eq 50 -and $v -eq 25) "before reconcile=$v1 after=$v $(Summ $jobs)"
  Dv -Method Post -Path "teams($($team.teamid))/Microsoft.Dynamics.CRM.RemoveMembersTeam" -Body @{ Members = @(@{ '@odata.type' = 'Microsoft.Dynamics.CRM.systemuser'; systemuserid = $me }) } | Out-Null

  # R10 Resolve API
  $r = Dv -Method Post -Path 'jhrb_ResolveEffectiveSettings' -Body @{}
  $settings = if ($r.Settings) { $r.Settings | ConvertFrom-Json } else { @() }
  $pg = $settings | ? setting -eq 'paginglimit'
  Check 'R10' 'jhrb_ResolveEffectiveSettings returns value, mode and source' ($pg.value -eq '50' -and $pg.mode -eq 'Default' -and $pg.source -eq 'Global' -and $r.InScope) "paginglimit=$($pg.value)/$($pg.mode)/$($pg.source) layers=$($r.Layers) $($r.DvError)"

  # R11 Chunked dry run over all licensed users (read-only; ignores pilot), small batches
  $t = ServerNow
  $before = Paging
  $r = Dv -Method Post -Path 'jhrb_ApplyDefaults' -Body @{ Scope = 'All'; DryRun = $true; IgnorePilot = $true; BatchSize = 20; ChunkSeconds = 1; ApplyMode = 'Full' }
  $jobs = @(WaitJob $t 632490000 600); $j = $jobs | Select-Object -First 1
  $okState = $j.jhrb_status -eq 632490002 -or ($j.jhrb_status -eq 632490000 -and $j.jhrb_chunks -ge 5)  # Pending = stopped at depth limit, resumed by heartbeat
  Check 'R11' 'Chunked dry run (20 users/page, 1 s/chunk) continues across executions, no writes' ($okState -and $j.jhrb_chunks -ge 2 -and $j.jhrb_processed -gt 20 -and (Paging) -eq $before) "$(Summ $jobs) $($r.DvError)"

  # R12 Heartbeat: one-off bulk delete -> Delete plugin -> reconcile job + next heartbeat row
  $t = ServerNow
  & "$PSScriptRoot\Setup-Heartbeat.ps1" -Org $Org -RunNow | Out-Null
  $jobs = @(WaitJob $t 632490004 600)
  $hb = @((Dv -Path "jhrb_heartbeats?`$select=jhrb_name,createdon&`$filter=createdon ge $($t.ToString('yyyy-MM-ddTHH:mm:ssZ'))").value)
  Check 'R12' 'Bulk delete of heartbeat starts reconcile and re-creates heartbeat' ($jobs.Count -ge 1 -and $hb.Count -ge 1) "$(Summ $jobs) new heartbeat rows=$($hb.Count)"
}
finally {
  foreach ($c in $cleanup) { Dv -Method Delete -Path $c | Out-Null }
  MyOverride | % { Dv -Method Delete -Path "jhrb_settingsprofiles($($_.jhrb_settingsprofileid))" | Out-Null }
  SetGlobal $INHERIT $null
  Start-Sleep 5
  SetPaging $orig
  "cleanup done: paginglimit=$(Paging)"
}

$md = @("# Phase 2-4 Integration Test Results", "", "Run: $((Get-Date).ToString('yyyy-MM-dd HH:mm')). Test user: the caller (only pilot team member). Dry run R11 reads all licensed users.", "",
  "| Id | Test | Result | Detail |", "|---|---|---|---|")
$md += $results | % { "| $($_.Id) | $($_.Test) | $($_.Result) | $($_.Detail -replace '\|','/') |" }
$md | Set-Content $OutFile -Encoding utf8
"{0} passed, {1} failed" -f @($results | ? Result -eq 'PASS').Count, @($results | ? Result -eq 'FAIL').Count
