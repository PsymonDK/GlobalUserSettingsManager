# Creates/updates the DefaultUserSettings solution schema from schema/settings.json. Idempotent: existing
# components are skipped (not modified). Run Build-Schema.ps1 first.
param(
  [string]$Org = $env:DUS_ORG_URL,
  [string]$Solution = 'DefaultUserSettings',
  [string]$Root = "$PSScriptRoot\.."
)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
$api = "$Org/api/data/v9.2"
$tok = az account get-access-token --resource $Org --query accessToken -o tsv
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/json'; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0' }
$settings = Get-Content "$Root\schema\settings.json" -Raw | ConvertFrom-Json

function Invoke-Dv([string]$Method = 'Get', [string]$Path, $Body, [switch]$NoSolution, [switch]$Return) {
  $h = $H.Clone()
  if ($Method -ne 'Get' -and -not $NoSolution) { $h['MSCRM.SolutionUniqueName'] = $Solution }
  if ($Return) { $h['Prefer'] = 'return=representation' }
  $p = @{ Method = $Method; Headers = $h; Uri = "$api/$Path" }
  if ($Body) { $p.ContentType = 'application/json; charset=utf-8'; $p.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 30)) }
  for ($try = 1; ; $try++) {
    try { return Invoke-RestMethod @p } catch {
      $msg = $_.ErrorDetails.Message
      if ($try -lt 4 -and ($msg -match 'customization|locked|0x80071151|try again|SqlException' -or $_.Exception.Response.StatusCode.value__ -in 429, 503)) { Start-Sleep -Seconds (5 * $try); continue }
      # Metadata cache lag after creating a table (scaled-out environments): retry reads for up to ~2 minutes.
      if ($Method -eq 'Get' -and $Path -like 'EntityDefinitions*/Attributes*' -and $msg -match 'does not exist' -and $try -lt 13) { Start-Sleep 10; continue }
      throw "$Method $Path failed: $msg"
    }
  }
}
function Label($t) { @{ '@odata.type' = 'Microsoft.Dynamics.CRM.Label'; LocalizedLabels = @(@{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = $t; LanguageCode = 1033 }) } }
function Opt($value, $label) { @{ Value = $value; Label = Label $label } }
function Req { @{ Value = 'None'; CanBeChanged = $true; ManagedPropertyLogicalName = 'canmodifyrequirementlevelsettings' } }
function Existing-Attributes($entity) {
  $set = @{}; (Invoke-Dv -Path "EntityDefinitions(LogicalName='$entity')/Attributes?`$select=LogicalName").value | % { $set[$_.LogicalName] = $true }; $set
}
function Table-Exists($entity) { try { Invoke-Dv -Path "EntityDefinitions(LogicalName='$entity')?`$select=LogicalName" | Out-Null; $true } catch { $false } }

function New-Table($schema, $display, $plural, $desc, $ownership, [switch]$Elastic) {
  $logical = $schema.ToLower()
  if (Table-Exists $logical) { "  table $logical exists"; return }
  $body = @{
    '@odata.type' = 'Microsoft.Dynamics.CRM.EntityMetadata'; SchemaName = $schema
    DisplayName = Label $display; DisplayCollectionName = Label $plural; Description = Label $desc
    OwnershipType = $ownership; HasActivities = $false; HasNotes = $false; IsActivity = $false
    Attributes = @(@{ '@odata.type' = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'; SchemaName = 'jhrb_Name'; IsPrimaryName = $true; MaxLength = 200
      DisplayName = Label 'Name'; RequiredLevel = Req; FormatName = @{ Value = 'Text' } })
  }
  if ($Elastic) { $body.TableType = 'Elastic' }
  Invoke-Dv -Method Post -Path 'EntityDefinitions' -Body $body | Out-Null
  "  table $logical created"
  # Metadata reads can lag behind the create on scaled-out environments.
  # Elastic tables provision asynchronously and can take several minutes.
  for ($i = 0; $i -lt 120 -and -not (Table-Exists $logical); $i++) { Start-Sleep 5 }
  if (-not (Table-Exists $logical)) { throw "$logical not visible after create" }
}

function Add-Column($entity, $existing, $body) {
  $logical = $body.SchemaName.ToLower()
  if ($existing.ContainsKey($logical)) { return }
  if (-not $body.RequiredLevel) { $body.RequiredLevel = Req }
  Invoke-Dv -Method Post -Path "EntityDefinitions(LogicalName='$entity')/Attributes" -Body $body | Out-Null
  $existing[$logical] = $true
  "  + $entity.$logical"
}
function Int-Col($schema, $label, $desc, $min = -2147483648, $max = 2147483647) {
  if ($null -eq $min) { $min = -2147483648 }; if ($null -eq $max) { $max = 2147483647 }
  @{ '@odata.type' = 'Microsoft.Dynamics.CRM.IntegerAttributeMetadata'; SchemaName = $schema; DisplayName = Label $label; Description = Label $desc; Format = 'None'; MinValue = [int]$min; MaxValue = [int]$max }
}
function Text-Col($schema, $label, $desc, $len) {
  @{ '@odata.type' = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'; SchemaName = $schema; DisplayName = Label $label; Description = Label $desc; MaxLength = [int]$len; FormatName = @{ Value = 'Text' } }
}
function Bool-Col($schema, $label, $desc, [bool]$default = $false) {
  @{ '@odata.type' = 'Microsoft.Dynamics.CRM.BooleanAttributeMetadata'; SchemaName = $schema; DisplayName = Label $label; Description = Label $desc; DefaultValue = $default
     OptionSet = @{ '@odata.type' = 'Microsoft.Dynamics.CRM.BooleanOptionSetMetadata'; TrueOption = Opt 1 'Yes'; FalseOption = Opt 0 'No' } }
}
function Choice-Col($schema, $label, $desc, $options, $default = $null) {
  $b = @{ '@odata.type' = 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata'; SchemaName = $schema; DisplayName = Label $label; Description = Label $desc
     OptionSet = @{ '@odata.type' = 'Microsoft.Dynamics.CRM.OptionSetMetadata'; IsGlobal = $false; OptionSetType = 'Picklist'; Options = @($options | % { Opt $_.value $_.label }) } }
  if ($null -ne $default) { $b.DefaultFormValue = $default }
  $b
}
function Lookup($entity, $existing, $schema, $label, $target, $relName, [switch]$Parental) {
  if ($existing.ContainsKey($schema.ToLower())) { return }
  $cascade = if ($Parental) {
    @{ Assign = 'Cascade'; Delete = 'Cascade'; Merge = 'NoCascade'; Reparent = 'Cascade'; Share = 'Cascade'; Unshare = 'Cascade'; RollupView = 'NoCascade' }
  } else { @{ Assign = 'NoCascade'; Delete = 'RemoveLink'; Merge = 'NoCascade'; Reparent = 'NoCascade'; Share = 'NoCascade'; Unshare = 'NoCascade'; RollupView = 'NoCascade' } }
  Invoke-Dv -Method Post -Path 'RelationshipDefinitions' -Body @{
    '@odata.type' = 'Microsoft.Dynamics.CRM.OneToManyRelationshipMetadata'; SchemaName = $relName
    ReferencedEntity = $target; ReferencingEntity = $entity; CascadeConfiguration = $cascade
    Lookup = @{ '@odata.type' = 'Microsoft.Dynamics.CRM.LookupAttributeMetadata'; SchemaName = $schema; DisplayName = Label $label; RequiredLevel = Req }
  } | Out-Null
  $existing[$schema.ToLower()] = $true
  "  + $entity.$($schema.ToLower()) -> $target"
}

# --- Solution
$pub = @((Invoke-Dv -Path "publishers?`$select=publisherid&`$filter=uniquename eq 'jhrb'").value)[0]
if (-not $pub) { throw 'Publisher jhrb missing' }
if (-not (Invoke-Dv -Path "solutions?`$select=solutionid&`$filter=uniquename eq '$Solution'").value) {
  Invoke-Dv -Method Post -NoSolution -Path 'solutions' -Body @{ uniquename = $Solution; friendlyname = 'Default User Settings'; version = '1.0.0.0'
    description = 'Default, grouped and lockable Dataverse user settings.'; 'publisherid@odata.bind' = "/publishers($($pub.publisherid))" } | Out-Null
  "solution $Solution created"
}

# --- Global choice: setting mode
$gos = $null
try { $gos = Invoke-Dv -Path "GlobalOptionSetDefinitions(Name='jhrb_settingmode')" } catch { }
if (-not $gos) {
  Invoke-Dv -Method Post -Path 'GlobalOptionSetDefinitions' -Body @{
    '@odata.type' = 'Microsoft.Dynamics.CRM.OptionSetMetadata'; Name = 'jhrb_settingmode'; DisplayName = Label 'Setting Mode'
    Description = Label 'Inherit: not managed on this layer. Default: value applied, user may change. Locked: value enforced.'
    IsGlobal = $true; OptionSetType = 'Picklist'
    Options = @((Opt 632490000 'Inherit'), (Opt 632490001 'Default'), (Opt 632490002 'Locked'))
  } | Out-Null
  "global choice jhrb_settingmode created"
  for ($i = 0; $i -lt 10 -and -not $gos; $i++) { Start-Sleep 3; try { $gos = Invoke-Dv -Path "GlobalOptionSetDefinitions(Name='jhrb_settingmode')" } catch { } }
  if (-not $gos) { throw 'jhrb_settingmode not readable after create' }
}
$gosId = $gos.MetadataId

# --- jhrb_settingsprofile
"jhrb_settingsprofile"
New-Table 'jhrb_SettingsProfile' 'Settings Profile' 'Settings Profiles' 'Default user settings: one Global row, Group rows (scoped by team/BU, prioritized) and per-user override rows.' 'OrganizationOwned'
$ex = Existing-Attributes 'jhrb_settingsprofile'
Add-Column 'jhrb_settingsprofile' $ex (Choice-Col 'jhrb_Type' 'Type' 'Global, Group or User.' @(@{value=632490000;label='Global'},@{value=632490001;label='Group'},@{value=632490002;label='User'}))
Add-Column 'jhrb_settingsprofile' $ex (Int-Col 'jhrb_Priority' 'Priority' 'Group profiles only. Higher wins. Must be unique.' 0 1000000)
Add-Column 'jhrb_settingsprofile' $ex (Bool-Col 'jhrb_IsActive' 'Active' 'Inactive profiles are ignored. An inactive Global row turns the feature off.' $true)
Lookup 'jhrb_settingsprofile' $ex 'jhrb_User' 'User' 'systemuser' 'jhrb_systemuser_jhrb_settingsprofile_User'
Lookup 'jhrb_settingsprofile' $ex 'jhrb_PilotTeam' 'Pilot Team' 'team' 'jhrb_team_jhrb_settingsprofile_PilotTeam'
foreach ($s in $settings) {
  $desc = "Default for usersettings.$($s.attribute)."
  $schema = 'jhrb_' + $s.attribute
  switch ($s.kind) {
    'Integer'    { Add-Column 'jhrb_settingsprofile' $ex (Int-Col $schema $s.label $desc $s.min $s.max) }
    'String'     { Add-Column 'jhrb_settingsprofile' $ex (Text-Col $schema $s.label $desc $s.maxLength) }
    'GuidText'   { Add-Column 'jhrb_settingsprofile' $ex (Text-Col $schema $s.label "$desc GUID." 36) }
    'LookupText' { Add-Column 'jhrb_settingsprofile' $ex (Text-Col $schema $s.label "$desc GUID of the $($s.target)." 36) }
    'Boolean'    { Add-Column 'jhrb_settingsprofile' $ex (Bool-Col $schema $s.label $desc) }
    'Choice'     { Add-Column 'jhrb_settingsprofile' $ex (Choice-Col $schema $s.label $desc $s.options) }
    'Lookup'     { Lookup 'jhrb_settingsprofile' $ex $schema $s.label $s.target "jhrb_$($s.target)_jhrb_settingsprofile_$($s.attribute)" }
  }
  Add-Column 'jhrb_settingsprofile' $ex @{
    '@odata.type' = 'Microsoft.Dynamics.CRM.PicklistAttributeMetadata'; SchemaName = "$schema`_mode"; DisplayName = Label "$($s.label) Mode"
    Description = Label "Inherit / Default / Locked for usersettings.$($s.attribute)."; DefaultFormValue = 632490000
    'GlobalOptionSet@odata.bind' = "/GlobalOptionSetDefinitions($gosId)"
  }
}

# --- jhrb_profilescope
"jhrb_profilescope"
New-Table 'jhrb_ProfileScope' 'Profile Scope' 'Profile Scopes' 'Membership rule for a Group profile. A profile applies if any of its scopes matches (OR).' 'OrganizationOwned'
$ex = Existing-Attributes 'jhrb_profilescope'
Lookup 'jhrb_profilescope' $ex 'jhrb_Profile' 'Profile' 'jhrb_settingsprofile' 'jhrb_settingsprofile_jhrb_profilescope_Profile' -Parental
Add-Column 'jhrb_profilescope' $ex (Choice-Col 'jhrb_ScopeType' 'Scope Type' 'Team or Business Unit.' @(@{value=632490000;label='Team'},@{value=632490001;label='Business Unit'}))
Lookup 'jhrb_profilescope' $ex 'jhrb_Team' 'Team' 'team' 'jhrb_team_jhrb_profilescope_Team'
Lookup 'jhrb_profilescope' $ex 'jhrb_BusinessUnit' 'Business Unit' 'businessunit' 'jhrb_businessunit_jhrb_profilescope_BusinessUnit'
Add-Column 'jhrb_profilescope' $ex (Bool-Col 'jhrb_IncludeChildBU' 'Include Child Business Units' 'Business Unit scopes only: also match users in child business units.')

# --- jhrb_settingslog (elastic, rows expire via ttlinseconds)
"jhrb_settingslog"
# Standard table (decision 27): elastic creation via Web API produced a standard table; retention is a recurring bulk delete instead of TTL.
New-Table 'jhrb_SettingsLog' 'Settings Log' 'Settings Logs' 'Audit of default-setting rollouts, new-user application and lock reverts. Rows older than 90 days are removed by a recurring bulk delete.' 'UserOwned'
$ex = Existing-Attributes 'jhrb_settingslog'
Lookup 'jhrb_settingslog' $ex 'jhrb_User' 'User' 'systemuser' 'jhrb_systemuser_jhrb_settingslog_User'
Lookup 'jhrb_settingslog' $ex 'jhrb_Profile' 'Profile' 'jhrb_settingsprofile' 'jhrb_settingsprofile_jhrb_settingslog_Profile'
Add-Column 'jhrb_settingslog' $ex (Text-Col 'jhrb_Setting' 'Setting' 'usersettings attribute.' 100)
Add-Column 'jhrb_settingslog' $ex (Text-Col 'jhrb_OldValue' 'Old Value' 'Value before the change, if known.' 4000)
Add-Column 'jhrb_settingslog' $ex (Text-Col 'jhrb_AttemptedValue' 'Attempted Value' 'Value the user or caller tried to save.' 4000)
Add-Column 'jhrb_settingslog' $ex (Text-Col 'jhrb_AppliedValue' 'Applied Value' 'Value stored after enforcement.' 4000)
Add-Column 'jhrb_settingslog' $ex (Choice-Col 'jhrb_Source' 'Source' 'What caused the entry.' @(@{value=632490000;label='Rollout'},@{value=632490001;label='New User'},@{value=632490002;label='Revert'},@{value=632490003;label='Manual'},@{value=632490004;label='Group Change'}))

function Memo-Col($schema, $label, $desc, $len = 100000) {
  @{ '@odata.type' = 'Microsoft.Dynamics.CRM.MemoAttributeMetadata'; SchemaName = $schema; DisplayName = Label $label; Description = Label $desc; MaxLength = $len }
}
function Date-Col($schema, $label, $desc) {
  @{ '@odata.type' = 'Microsoft.Dynamics.CRM.DateTimeAttributeMetadata'; SchemaName = $schema; DisplayName = Label $label; Description = Label $desc; Format = 'DateAndTime'
     DateTimeBehavior = @{ Value = 'UserLocal' } }
}

# --- jhrb_rolloutjob (chunked rollout state, plan 4.3 / 5.4)
"jhrb_rolloutjob"
New-Table 'jhrb_RolloutJob' 'Rollout Job' 'Rollout Jobs' 'Chunked application of effective settings to users. Processed by an async plugin; continues itself until the cursor reaches the end.' 'OrganizationOwned'
$ex = Existing-Attributes 'jhrb_rolloutjob'
Add-Column 'jhrb_rolloutjob' $ex (Choice-Col 'jhrb_Status' 'Status' 'Job state.' @(@{value=632490000;label='Pending'},@{value=632490001;label='Running'},@{value=632490002;label='Completed'},@{value=632490003;label='Failed'},@{value=632490004;label='Cancelled'}) 632490000)
Add-Column 'jhrb_rolloutjob' $ex (Choice-Col 'jhrb_Scope' 'Scope' 'All users in scope, or one user.' @(@{value=632490000;label='All'},@{value=632490001;label='User'}) 632490000)
Add-Column 'jhrb_rolloutjob' $ex (Choice-Col 'jhrb_ApplyMode' 'Apply Mode' 'Full: Default and Locked settings. Locked Only: enforce locks. Auto: full for users whose layers changed or who were never initialized, otherwise locked only.' @(@{value=632490000;label='Full'},@{value=632490001;label='Locked Only'},@{value=632490002;label='Auto'}) 632490000)
Add-Column 'jhrb_rolloutjob' $ex (Choice-Col 'jhrb_Reason' 'Reason' 'What created the job.' @(@{value=632490000;label='Manual'},@{value=632490001;label='Profile Change'},@{value=632490002;label='New User'},@{value=632490003;label='Membership Change'},@{value=632490004;label='Reconcile'},@{value=632490005;label='User Override'}) 632490000)
Lookup 'jhrb_rolloutjob' $ex 'jhrb_User' 'User' 'systemuser' 'jhrb_systemuser_jhrb_rolloutjob_User'
Lookup 'jhrb_rolloutjob' $ex 'jhrb_Profile' 'Profile' 'jhrb_settingsprofile' 'jhrb_settingsprofile_jhrb_rolloutjob_Profile'
Add-Column 'jhrb_rolloutjob' $ex (Text-Col 'jhrb_SettingFilter' 'Setting Filter' 'Comma-separated usersettings attributes. Empty = all managed settings.' 4000)
Add-Column 'jhrb_rolloutjob' $ex (Bool-Col 'jhrb_DryRun' 'Dry Run' 'Compute and count differences without writing.')
Add-Column 'jhrb_rolloutjob' $ex (Bool-Col 'jhrb_IgnorePilot' 'Ignore Pilot Team' 'Dry runs only: evaluate all users in scope, not just the pilot team.')
Add-Column 'jhrb_rolloutjob' $ex (Text-Col 'jhrb_Cursor' 'Cursor' 'Last systemuserid processed.' 100)
Add-Column 'jhrb_rolloutjob' $ex (Int-Col 'jhrb_BatchSize' 'Batch Size' 'Users per page.' 1 5000)
Add-Column 'jhrb_rolloutjob' $ex (Int-Col 'jhrb_ChunkSeconds' 'Chunk Seconds' 'Time budget per plugin execution (default 90; max 110). Lower values force more continuations.' 1 110)
foreach ($c in 'Processed', 'Updated', 'Unchanged', 'Failed', 'Chunks', 'Continue') { Add-Column 'jhrb_rolloutjob' $ex (Int-Col "jhrb_$c" $c "$c counter." 0 2147483647) }
Add-Column 'jhrb_rolloutjob' $ex (Date-Col 'jhrb_StartedOn' 'Started On' 'First chunk started.')
Add-Column 'jhrb_rolloutjob' $ex (Date-Col 'jhrb_CompletedOn' 'Completed On' 'Job finished.')
Add-Column 'jhrb_rolloutjob' $ex (Memo-Col 'jhrb_Error' 'Error' 'Errors (last 100000 characters).')

# --- jhrb_userstate (per-user layer fingerprint; drives Auto apply mode)
"jhrb_userstate"
New-Table 'jhrb_UserState' 'User Settings State' 'User Settings States' 'Per user: which profile layers applied at the last full apply. A changed fingerprint means membership changed.' 'OrganizationOwned'
$ex = Existing-Attributes 'jhrb_userstate'
Lookup 'jhrb_userstate' $ex 'jhrb_User' 'User' 'systemuser' 'jhrb_systemuser_jhrb_userstate_User'
Add-Column 'jhrb_userstate' $ex (Text-Col 'jhrb_LayerFingerprint' 'Layer Fingerprint' 'Sorted IDs of the applicable profiles at the last full apply.' 4000)
Add-Column 'jhrb_userstate' $ex (Date-Col 'jhrb_LastFullApplyOn' 'Last Full Apply' 'Last time Default and Locked values were applied.')
Add-Column 'jhrb_userstate' $ex (Date-Col 'jhrb_InitializedOn' 'Initialized On' 'First full apply (new-user handling).')

# --- jhrb_heartbeat (daily reconcile trigger via recurring bulk delete)
"jhrb_heartbeat"
New-Table 'jhrb_Heartbeat' 'Settings Heartbeat' 'Settings Heartbeats' 'Deleted daily by a recurring bulk delete job; the Delete plugin starts the reconcile and creates the next row.' 'OrganizationOwned'

# --- Publish
"publishing"
$xml = '<importexportxml><entities><entity>jhrb_settingsprofile</entity><entity>jhrb_profilescope</entity><entity>jhrb_settingslog</entity><entity>jhrb_rolloutjob</entity><entity>jhrb_userstate</entity><entity>jhrb_heartbeat</entity></entities><optionsets><optionset>jhrb_settingmode</optionset></optionsets></importexportxml>'
Invoke-Dv -Method Post -NoSolution -Path 'PublishXml' -Body @{ ParameterXml = $xml } | Out-Null
"done"
