# Phase 1 integration tests against a dev environment, on ONE test user (default: the caller).
# The test user must be in the Global row's pilot team. Restores the user's paginglimit and the Global row afterwards.
param(
  [string]$Org = $env:DUS_ORG_URL,
  [string]$OutFile = "$PSScriptRoot\..\docs\test-results-phase1.md"
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
$who = Dv -Path 'WhoAmI'; $me = $who.UserId; $myBu = $who.BusinessUnitId
$global = @((Dv -Path "jhrb_settingsprofiles?`$select=jhrb_settingsprofileid,_jhrb_pilotteam_value&`$filter=jhrb_type eq 632490000").value)[0]
if (-not $global) { throw 'Run Seed-GlobalProfile.ps1 first' }
$gid = $global.jhrb_settingsprofileid; $pilot = $global._jhrb_pilotteam_value
$orig = (Dv -Path "usersettingscollection($me)?`$select=paginglimit").paginglimit
$results = New-Object System.Collections.ArrayList
$created = New-Object System.Collections.ArrayList
function Check($id, $name, [bool]$ok, $detail) { [void]$results.Add([pscustomobject]@{ Id = $id; Test = $name; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Detail = $detail }); "{0} {1}: {2} ({3})" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $id, $name, $detail }
function SetPaging($v) { Dv -Method Patch -Path "usersettingscollection($me)" -Body @{ paginglimit = $v } }
function Paging { (Dv -Path "usersettingscollection($me)?`$select=paginglimit").paginglimit }
function SetGlobal($mode, $value) { Dv -Method Patch -Path "jhrb_settingsprofiles($gid)" -Body @{ jhrb_paginglimit = $value; jhrb_paginglimit_mode = $mode } | Out-Null }
function LastLog { @((Dv -Path "jhrb_settingslogs?`$select=jhrb_setting,jhrb_attemptedvalue,jhrb_appliedvalue,jhrb_source,_jhrb_profile_value,createdon&`$filter=_jhrb_user_value eq $me&`$orderby=createdon desc&`$top=1").value)[0] }
$INHERIT = 632490000; $DEFAULT = 632490001; $LOCKED = 632490002

try {
  # T1 unlocked default: user change persists
  SetGlobal $DEFAULT 50; SetPaging 50 | Out-Null; SetPaging 75 | Out-Null
  $v = Paging; Check 'T1' 'Default (unlocked): user change persists' ($v -eq 75) "paginglimit=$v"

  # T2 locked: user change reverted + log row
  SetGlobal $LOCKED 50; $before = LastLog; SetPaging 100 | Out-Null
  $v = Paging; $log = LastLog
  Check 'T2' 'Locked: user change reverted silently' ($v -eq 50) "paginglimit=$v"
  Check 'T2b' 'Locked: revert logged' ($log -and $log.createdon -ne $before.createdon -and $log.jhrb_source -eq 632490002 -and $log.jhrb_attemptedvalue -eq '100' -and $log.jhrb_appliedvalue -eq '50') "log: $($log.jhrb_setting) $($log.jhrb_attemptedvalue)->$($log.jhrb_appliedvalue) source=$($log.jhrb_source)"

  # T3 unchanged locked value: no revert row
  $before = LastLog; SetPaging 50 | Out-Null; $after = LastLog
  Check 'T3' 'Locked, same value: no log row' ($after.createdon -eq $before.createdon) ''

  # T4 group (team scope) overrides global lock
  $g1 = Dv -Method Post -Path 'jhrb_settingsprofiles' -Body @{ jhrb_name = 'IT Team scope'; jhrb_type = 632490001; jhrb_priority = 10; jhrb_paginglimit = 25; jhrb_paginglimit_mode = $LOCKED }
  [void]$created.Add("jhrb_settingsprofiles($($g1.jhrb_settingsprofileid))")
  $s1 = Dv -Method Post -Path 'jhrb_profilescopes' -Body @{ jhrb_name = 'Pilot team'; jhrb_scopetype = 632490000; 'jhrb_Profile@odata.bind' = "/jhrb_settingsprofiles($($g1.jhrb_settingsprofileid))"; 'jhrb_Team@odata.bind' = "/teams($pilot)" }
  SetPaging 100 | Out-Null; $v = Paging; $log = LastLog
  Check 'T4' 'Group (team scope) lock wins over Global' ($v -eq 25 -and $log._jhrb_profile_value -eq $g1.jhrb_settingsprofileid) "paginglimit=$v, log profile=$($log._jhrb_profile_value)"

  # T5 higher-priority BU group wins; inherit falls through
  $g2 = Dv -Method Post -Path 'jhrb_settingsprofiles' -Body @{ jhrb_name = 'My BU scope'; jhrb_type = 632490001; jhrb_priority = 20; jhrb_paginglimit = 250; jhrb_paginglimit_mode = $DEFAULT }
  [void]$created.Insert(0, "jhrb_settingsprofiles($($g2.jhrb_settingsprofileid))")
  Dv -Method Post -Path 'jhrb_profilescopes' -Body @{ jhrb_name = 'My BU'; jhrb_scopetype = 632490001; 'jhrb_Profile@odata.bind' = "/jhrb_settingsprofiles($($g2.jhrb_settingsprofileid))"; 'jhrb_BusinessUnit@odata.bind' = "/businessunits($myBu)" } | Out-Null
  SetPaging 100 | Out-Null; $v = Paging
  Check 'T5' 'Higher-priority BU group (Default) unlocks: change persists' ($v -eq 100) "paginglimit=$v"
  Dv -Method Patch -Path "jhrb_settingsprofiles($($g2.jhrb_settingsprofileid))" -Body @{ jhrb_paginglimit_mode = $INHERIT } | Out-Null
  SetPaging 100 | Out-Null; $v = Paging
  Check 'T5b' 'Higher group set to Inherit: lower group lock applies again' ($v -eq 25) "paginglimit=$v"

  # T6 inactive group ignored
  Dv -Method Patch -Path "jhrb_settingsprofiles($($g1.jhrb_settingsprofileid))" -Body @{ jhrb_isactive = $false } | Out-Null
  SetPaging 100 | Out-Null; $v = Paging
  Check 'T6' 'Inactive group ignored: Global lock applies' ($v -eq 50) "paginglimit=$v"

  # T7 validation
  $r = Dv -Method Post -Path 'jhrb_settingsprofiles' -Body @{ jhrb_name = 'Second global'; jhrb_type = 632490000 }
  if (-not $r.DvError) { [void]$created.Add("jhrb_settingsprofiles($($r.jhrb_settingsprofileid))") }
  Check 'T7' 'Validation: second Global rejected' ($r.DvError -match 'Only one Global') "$($r.DvError)"
  $r = Dv -Method Post -Path 'jhrb_settingsprofiles' -Body @{ jhrb_name = 'Dup priority'; jhrb_type = 632490001; jhrb_priority = 20 }
  if (-not $r.DvError) { [void]$created.Add("jhrb_settingsprofiles($($r.jhrb_settingsprofileid))") }
  Check 'T7b' 'Validation: duplicate group priority rejected' ($r.DvError -match 'priority 20') "$($r.DvError)"
  $r = Dv -Method Patch -Path "jhrb_settingsprofiles($gid)" -Body @{ jhrb_timezonecode_mode = $LOCKED }
  Check 'T7c' 'Validation: Locked without value rejected' ($r.DvError -match 'has no value') "$($r.DvError)"
  $r = Dv -Method Post -Path 'jhrb_profilescopes' -Body @{ jhrb_name = 'Bad'; jhrb_scopetype = 632490000; 'jhrb_Profile@odata.bind' = "/jhrb_settingsprofiles($gid)"; 'jhrb_Team@odata.bind' = "/teams($pilot)" }
  Check 'T7d' 'Validation: scope on Global rejected' ($r.DvError -match 'only be added to Group') "$($r.DvError)"

  # T8 pilot: global inactive = feature off
  Dv -Method Patch -Path "jhrb_settingsprofiles($gid)" -Body @{ jhrb_isactive = $false } | Out-Null
  SetPaging 100 | Out-Null; $v = Paging
  Check 'T8' 'Inactive Global row: nothing enforced' ($v -eq 100) "paginglimit=$v"
  Dv -Method Patch -Path "jhrb_settingsprofiles($gid)" -Body @{ jhrb_isactive = $true } | Out-Null
}
finally {
  foreach ($c in $created) { Dv -Method Delete -Path $c | Out-Null }
  SetGlobal $INHERIT $null
  SetPaging $orig | Out-Null
  "cleanup done: paginglimit=$(Paging)"
}

$md = @("# Phase 1 Integration Test Results", "", "Environment: dev. Run: $((Get-Date).ToString('yyyy-MM-dd HH:mm')). Test user: the caller (own user, pilot team member).", "",
  "| Id | Test | Result | Detail |", "|---|---|---|---|")
$md += $results | % { "| $($_.Id) | $($_.Test) | $($_.Result) | $($_.Detail -replace '\|','/') |" }
$md | Set-Content $OutFile -Encoding utf8
"{0} passed, {1} failed" -f @($results | ? Result -eq 'PASS').Count, @($results | ? Result -eq 'FAIL').Count
