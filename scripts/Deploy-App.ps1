# Model-driven admin app (plan section 7, "plain model-driven app first"): generates the Settings Profile main form
# (one tab per setting group, value + mode side by side), views, a sitemap and the app module. Idempotent: forms and
# views are overwritten from schema/settings.json; the app is created once.
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
function Get-Dv($path) { $r = Invoke-RestMethod -Headers $H -Uri "$api/$path"; if ($r.PSObject.Properties.Name -contains 'value') { $r.value } else { $r } }
function Send-Dv($method, $path, $body) {
  $h = $H.Clone(); $h['MSCRM.SolutionUniqueName'] = $Solution; $h['Prefer'] = 'return=representation'
  try { Invoke-RestMethod -Method $method -Headers $h -Uri "$api/$path" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 20))) }
  catch { throw "$method $path failed: $($_.ErrorDetails.Message)" }
}
$settings = Get-Content "$Root\schema\settings.json" -Raw | ConvertFrom-Json
function NewId { '{' + [guid]::NewGuid().ToString().ToUpper() + '}' }
function X($s) { [Security.SecurityElement]::Escape($s) }

$class = @{
  Text = '{4273EDBD-AC1D-40d3-9FB2-095C621B552D}'; Integer = '{C6D124CA-7EDA-4a60-AEA9-7FB8D318B68F}'; Choice = '{3EF39988-22BB-4f0b-BBBE-64B5A3748AEE}'
  Boolean = '{67FAC785-CD58-4f9f-ABB3-4B7DDC6ED5ED}'; Lookup = '{270BD3DB-D9AF-4782-9025-509E298DEC0A}'; DateTime = '{5B773807-9FB2-42db-97C3-7A91EFF8ADFF}'
  Memo = '{E0DECE4B-6FC8-4a8f-A065-082708572369}'; Grid = '{E7A81278-8635-4d9e-8D4D-59480B391C5B}'
}
function Cell($field, $label, $kind) { "<cell id=`"$(NewId)`"><labels><label description=`"$(X $label)`" languagecode=`"1033`" /></labels><control id=`"$field`" classid=`"$($class[$kind])`" datafieldname=`"$field`" disabled=`"false`" /></cell>" }
function Section($name, $label, $rows, $columns = '1') { "<section name=`"$name`" showlabel=`"true`" showbar=`"false`" id=`"$(NewId)`" columns=`"$columns`"><labels><label description=`"$(X $label)`" languagecode=`"1033`" /></labels><rows>$($rows -join '')</rows></section>" }
function Tab($name, $label, $sections) { "<tab name=`"$name`" id=`"$(NewId)`" expanded=`"true`" showlabel=`"true`"><labels><label description=`"$(X $label)`" languagecode=`"1033`" /></labels><columns><column width=`"100%`"><sections>$($sections -join '')</sections></column></columns></tab>" }
function Grid($id, $label, $relationship, $entity, $viewId) {
  "<row><cell id=`"$(NewId)`" colspan=`"2`" rowspan=`"8`"><labels><label description=`"$(X $label)`" languagecode=`"1033`" /></labels><control id=`"$id`" classid=`"$($class.Grid)`" indicationOfSubgrid=`"true`"><parameters><RecordsPerPage>10</RecordsPerPage><AutoExpand>Fixed</AutoExpand><EnableQuickFind>false</EnableQuickFind><EnableViewPicker>false</EnableViewPicker><EnableJumpBar>false</EnableJumpBar><RelationshipName>$relationship</RelationshipName><TargetEntityType>$entity</TargetEntityType><ViewId>$viewId</ViewId><IsUserView>false</IsUserView></parameters></control></cell></row>" + ('<row />' * 7)
}
function Kind($s) { switch ($s.kind) { 'Integer' { 'Integer' } 'Boolean' { 'Boolean' } 'Choice' { 'Choice' } 'Lookup' { 'Lookup' } default { 'Text' } } }
function DefaultView($entity) { @(Get-Dv "savedqueries?`$select=savedqueryid&`$filter=returnedtypecode eq '$entity' and querytype eq 0 and isdefault eq true")[0].savedqueryid }
function MainForm($entity) { @(Get-Dv "systemforms?`$select=formid,name&`$filter=objecttypecode eq '$entity' and type eq 2")[0] }

function Set-View($entity, $primaryId, $columns, $order, $filterXml = '') {
  $vid = DefaultView $entity
  $attrs = ($columns | % { "<attribute name=`"$($_.n)`" />" }) -join ''
  $fetch = "<fetch version=`"1.0`" mapping=`"logical`"><entity name=`"$entity`">$attrs<attribute name=`"$primaryId`" /><order attribute=`"$order`" descending=`"$(if ($order -eq 'createdon') {'true'} else {'false'})`" />$filterXml</entity></fetch>"
  $cells = ($columns | % { "<cell name=`"$($_.n)`" width=`"$($_.w)`" />" }) -join ''
  $layout = "<grid name=`"resultset`" object=`"1`" jump=`"jhrb_name`" select=`"1`" icon=`"1`" preview=`"1`"><row name=`"result`" id=`"$primaryId`">$cells</row></grid>"
  Send-Dv Patch "savedqueries($vid)" @{ fetchxml = $fetch; layoutxml = $layout } | Out-Null
  Write-Host "  view updated: $entity"
  '{' + $vid.ToString().ToUpper() + '}'
}

"views"
$active = '<filter type="and"><condition attribute="statecode" operator="eq" value="0" /></filter>'
$profileView = Set-View 'jhrb_settingsprofile' 'jhrb_settingsprofileid' @(@{n='jhrb_name';w=250},@{n='jhrb_type';w=100},@{n='jhrb_priority';w=80},@{n='jhrb_isactive';w=80},@{n='jhrb_user';w=180},@{n='jhrb_pilotteam';w=150},@{n='modifiedon';w=140}) 'jhrb_name' $active
$scopeView = Set-View 'jhrb_profilescope' 'jhrb_profilescopeid' @(@{n='jhrb_name';w=200},@{n='jhrb_profile';w=180},@{n='jhrb_scopetype';w=120},@{n='jhrb_team';w=180},@{n='jhrb_businessunit';w=180},@{n='jhrb_includechildbu';w=100}) 'jhrb_name' $active
$logView = Set-View 'jhrb_settingslog' 'jhrb_settingslogid' @(@{n='createdon';w=140},@{n='jhrb_user';w=160},@{n='jhrb_source';w=100},@{n='jhrb_setting';w=160},@{n='jhrb_oldvalue';w=120},@{n='jhrb_attemptedvalue';w=120},@{n='jhrb_appliedvalue';w=120},@{n='jhrb_profile';w=160}) 'createdon'
$jobView = Set-View 'jhrb_rolloutjob' 'jhrb_rolloutjobid' @(@{n='jhrb_name';w=250},@{n='jhrb_status';w=100},@{n='jhrb_reason';w=120},@{n='jhrb_scope';w=80},@{n='jhrb_applymode';w=100},@{n='jhrb_processed';w=80},@{n='jhrb_updated';w=80},@{n='jhrb_failed';w=70},@{n='createdon';w=140}) 'createdon'
$stateView = Set-View 'jhrb_userstate' 'jhrb_userstateid' @(@{n='jhrb_user';w=200},@{n='jhrb_initializedon';w=140},@{n='jhrb_lastfullapplyon';w=140},@{n='jhrb_layerfingerprint';w=300}) 'jhrb_name'

"forms"
# Settings Profile: General tab (identity, scopes, recent log), then one tab per setting group with value | mode rows.
$generalRows = @(
  "<row>$(Cell 'jhrb_name' 'Name' 'Text')</row><row>$(Cell 'jhrb_type' 'Type' 'Choice')</row>",
  "<row>$(Cell 'jhrb_isactive' 'Active' 'Boolean')</row><row>$(Cell 'jhrb_priority' 'Priority (Group)' 'Integer')</row>",
  "<row>$(Cell 'jhrb_user' 'User (User override)' 'Lookup')</row><row>$(Cell 'jhrb_pilotteam' 'Pilot Team (Global)' 'Lookup')</row>")
$tabs = @(Tab 'tab_general' 'General' @(
  (Section 'sec_profile' 'Profile' $generalRows),
  (Section 'sec_scopes' 'Scopes (Group profiles: applies to members of any of these teams / business units)' @(Grid 'Scopes' 'Scopes' 'jhrb_settingsprofile_jhrb_profilescope_Profile' 'jhrb_profilescope' $scopeView) '1'),
  (Section 'sec_log' 'Recent changes caused by this profile' @(Grid 'Log' 'Log' 'jhrb_settingsprofile_jhrb_settingslog_Profile' 'jhrb_settingslog' $logView) '1')))
foreach ($g in ($settings | Group-Object group)) {
  $rows = foreach ($s in $g.Group) { "<row>$(Cell $s.valueColumn $s.label (Kind $s))</row><row>$(Cell $s.modeColumn "$($s.label): mode" 'Choice')</row>" }
  $tabs += Tab ("tab_" + $g.Name.ToLower()) $g.Name @(Section ("sec_" + $g.Name.ToLower()) "$($g.Name) (value | Inherit / Default / Locked)" $rows)
}
$formXml = "<form><tabs>$($tabs -join '')</tabs></form>"
$pf = MainForm 'jhrb_settingsprofile'
Send-Dv Patch "systemforms($($pf.formid))" @{ formxml = $formXml; name = 'Settings Profile' } | Out-Null
"  form updated: Settings Profile"

$sf = MainForm 'jhrb_profilescope'
$scopeForm = "<form><tabs>$(Tab 'tab_general' 'General' @(Section 'sec_scope' 'Scope' @(
  "<row>$(Cell 'jhrb_name' 'Name' 'Text')</row><row>$(Cell 'jhrb_profile' 'Profile' 'Lookup')</row>",
  "<row>$(Cell 'jhrb_scopetype' 'Scope Type' 'Choice')</row><row>$(Cell 'jhrb_includechildbu' 'Include Child Business Units' 'Boolean')</row>",
  "<row>$(Cell 'jhrb_team' 'Team' 'Lookup')</row><row>$(Cell 'jhrb_businessunit' 'Business Unit' 'Lookup')</row>")))</tabs></form>"
Send-Dv Patch "systemforms($($sf.formid))" @{ formxml = $scopeForm } | Out-Null
"  form updated: Profile Scope"

$jf = MainForm 'jhrb_rolloutjob'
$jobForm = "<form><tabs>$(Tab 'tab_general' 'General' @(
  (Section 'sec_job' 'Job' @(
    "<row>$(Cell 'jhrb_name' 'Name' 'Text')</row><row>$(Cell 'jhrb_status' 'Status' 'Choice')</row>",
    "<row>$(Cell 'jhrb_reason' 'Reason' 'Choice')</row><row>$(Cell 'jhrb_scope' 'Scope' 'Choice')</row>",
    "<row>$(Cell 'jhrb_applymode' 'Apply Mode' 'Choice')</row><row>$(Cell 'jhrb_user' 'User' 'Lookup')</row>",
    "<row>$(Cell 'jhrb_settingfilter' 'Setting Filter' 'Text')</row><row>$(Cell 'jhrb_profile' 'Profile' 'Lookup')</row>",
    "<row>$(Cell 'jhrb_dryrun' 'Dry Run' 'Boolean')</row><row>$(Cell 'jhrb_ignorepilot' 'Ignore Pilot (dry run)' 'Boolean')</row>",
    "<row>$(Cell 'jhrb_batchsize' 'Batch Size' 'Integer')</row><row>$(Cell 'jhrb_cursor' 'Cursor' 'Text')</row>")),
  (Section 'sec_progress' 'Progress' @(
    "<row>$(Cell 'jhrb_processed' 'Processed' 'Integer')</row><row>$(Cell 'jhrb_updated' 'Updated' 'Integer')</row>",
    "<row>$(Cell 'jhrb_unchanged' 'Unchanged' 'Integer')</row><row>$(Cell 'jhrb_failed' 'Failed' 'Integer')</row>",
    "<row>$(Cell 'jhrb_chunks' 'Chunks' 'Integer')</row><row>$(Cell 'jhrb_continue' 'Continue' 'Integer')</row>",
    "<row>$(Cell 'jhrb_startedon' 'Started On' 'DateTime')</row><row>$(Cell 'jhrb_completedon' 'Completed On' 'DateTime')</row>",
    "<row>$(Cell 'jhrb_error' 'Error' 'Memo')</row>"))))</tabs></form>"
Send-Dv Patch "systemforms($($jf.formid))" @{ formxml = $jobForm } | Out-Null
"  form updated: Rollout Job"

"app"
$entities = 'jhrb_settingsprofile', 'jhrb_profilescope', 'jhrb_rolloutjob', 'jhrb_settingslog', 'jhrb_userstate'
# Generative pages (src/GenPages, deployed by Deploy-GenPages.ps1) get their own group at the top, if they exist.
$genSubAreas = ''
$genManifest = "$Root\src\GenPages\pages.json"
if (Test-Path $genManifest) {
  foreach ($p in (Get-Content $genManifest -Raw | ConvertFrom-Json).pages) {
    $gid = @(Get-Dv "uxagentprojects?`$select=uxagentprojectid&`$filter=name eq '$($p.name -replace "'", "''")'")[0].uxagentprojectid
    if ($gid) {
      $genSubAreas += "<SubArea Id=`"sub_gen_$($p.key)`" VectorIcon=`"/_imgs/TableIconsFluentV9/document_one_page_sparkle.svg`" Client=`"All,Outlook,OutlookLaptopClient,OutlookWorkstationClient,Web`" " +
        "AvailableOffline=`"true`" PassParams=`"false`" Sku=`"All,OnPremise,Live,SPLA`" GenPageId=`"$gid`"><Titles><Title LCID=`"1033`" Title=`"$(X $p.title)`" /></Titles></SubArea>"
    }
  }
}
$genGroup = if ($genSubAreas) { "<Group Id=`"grp_manage`"><Titles><Title LCID=`"1033`" Title=`"Settings manager`" /></Titles>$genSubAreas</Group>" } else { '' }
$sitemapXml = "<SiteMap IntroducedVersion=`"7.0.0.0`"><Area Id=`"area_dus`" ShowGroups=`"true`"><Titles><Title LCID=`"1033`" Title=`"Default User Settings`" /></Titles>" + $genGroup +
  "<Group Id=`"grp_config`"><Titles><Title LCID=`"1033`" Title=`"Configuration`" /></Titles>" +
  "<SubArea Id=`"sub_profiles`" Entity=`"jhrb_settingsprofile`" /><SubArea Id=`"sub_scopes`" Entity=`"jhrb_profilescope`" /></Group>" +
  "<Group Id=`"grp_ops`"><Titles><Title LCID=`"1033`" Title=`"Operations`" /></Titles>" +
  "<SubArea Id=`"sub_jobs`" Entity=`"jhrb_rolloutjob`" /><SubArea Id=`"sub_log`" Entity=`"jhrb_settingslog`" /><SubArea Id=`"sub_state`" Entity=`"jhrb_userstate`" /></Group></Area></SiteMap>"
$sm = @(Get-Dv "sitemaps?`$select=sitemapid&`$filter=sitemapnameunique eq 'jhrb_DefaultUserSettings'")[0]
if ($sm) { Send-Dv Patch "sitemaps($($sm.sitemapid))" @{ sitemapxml = $sitemapXml } | Out-Null; $smId = $sm.sitemapid }
else { $smId = (Send-Dv Post 'sitemaps' @{ sitemapname = 'Default User Settings'; sitemapnameunique = 'jhrb_DefaultUserSettings'; isappaware = $true; sitemapxml = $sitemapXml }).sitemapid }
# Unpublished app modules are not readable through appmodules, so the id is cached in schema/app.local.json.
$appFile = "$Root\schema\app.local.json"
$appId = @(Get-Dv "appmodules?`$select=appmoduleid&`$filter=uniquename eq 'jhrb_DefaultUserSettings'")[0].appmoduleid
if (-not $appId -and (Test-Path $appFile)) { $appId = (Get-Content $appFile -Raw | ConvertFrom-Json).appId }
if (-not $appId) {
  $h = $H.Clone(); $h['MSCRM.SolutionUniqueName'] = $Solution
  $resp = Invoke-WebRequest -Method Post -Headers $h -Uri "$api/appmodules" -ContentType 'application/json; charset=utf-8' -UseBasicParsing -Body ([Text.Encoding]::UTF8.GetBytes((@{
    name = 'Default User Settings'; uniquename = 'jhrb_DefaultUserSettings'; description = 'Manage default, grouped and locked Dataverse user settings.'
    clienttype = 4; formfactor = 1; navigationtype = 0; webresourceid = '953b9fac-1e5e-e611-80d6-00155ded156f' } | ConvertTo-Json)))
  $appId = [regex]::Match($resp.Headers['OData-EntityId'], '\(([0-9a-fA-F-]{36})\)').Groups[1].Value
  "  app created"
}
@{ appId = $appId } | ConvertTo-Json | Set-Content $appFile -Encoding utf8
$components = @(@{ '@odata.type' = 'Microsoft.Dynamics.CRM.sitemap'; sitemapid = $smId })
foreach ($e in $entities) { $components += @{ '@odata.type' = 'Microsoft.Dynamics.CRM.entity'; entityid = (Get-Dv "EntityDefinitions(LogicalName='$e')?`$select=MetadataId").MetadataId } }
Invoke-RestMethod -Method Post -Headers $H -Uri "$api/AddAppComponents" -ContentType 'application/json' -Body (@{ AppId = $appId; Components = $components } | ConvertTo-Json -Depth 5) | Out-Null
"  components added"

"commands"
# Web resource with the form command scripts (upsert by name).
$wrName = 'jhrb_/scripts/settingsprofile.js'
$wrContent = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$Root\src\WebResources\settingsprofile.js"))
$wr = @(Get-Dv "webresourceset?`$select=webresourceid&`$filter=name eq '$wrName'")[0]
if ($wr) { Send-Dv Patch "webresourceset($($wr.webresourceid))" @{ content = $wrContent } | Out-Null; $wrId = $wr.webresourceid; "  web resource updated" }
else { $wrId = (Send-Dv Post 'webresourceset' @{ name = $wrName; displayname = 'Settings Profile form commands'; webresourcetype = 3; content = $wrContent }).webresourceid; "  web resource created" }

# Modern command (appaction) on the Settings Profile form: "Load current values". Parameter type 5 = PrimaryControl.
$profileMeta = (Get-Dv "EntityDefinitions(LogicalName='jhrb_settingsprofile')?`$select=MetadataId").MetadataId
$cmdUnique = 'jhrb_LoadCurrentValues!jhrb_DefaultUserSettings!jhrb_settingsprofile!0'
$cmd = @{
  name = 'jhrb_LoadCurrentValues'; uniquename = $cmdUnique; buttonlabeltext = 'Load current values'
  buttontooltiptitle = 'Load current values'; buttontooltipdescription = "Copy the user's current personal settings into this profile's values. Modes are not changed."
  context = 1; contextvalue = 'jhrb_settingsprofile'; location = 0; type = 0; visibilitytype = 0; onclickeventtype = 2
  onclickeventjavascriptfunctionname = 'jhrb.SettingsProfile.loadCurrentValues'; onclickeventjavascriptparameters = '[{"type":5}]'
  fonticon = '$clientsvg:Download'; sequence = 100100100
  'ContextEntity@odata.bind' = "/entities($profileMeta)"; 'AppModuleId@odata.bind' = "/appmodules($appId)"
  'OnClickEventJavaScriptWebResourceId@odata.bind' = "/webresourceset($wrId)"
}
$existing = @(Get-Dv "appactions?`$select=appactionid&`$filter=uniquename eq '$cmdUnique'")[0]
if ($existing) { $cmd.Remove('uniquename'); Send-Dv Patch "appactions($($existing.appactionid))" $cmd | Out-Null; "  command updated: Load current values" }
else { Send-Dv Post 'appactions' $cmd | Out-Null; "  command created: Load current values" }

$roles = if (Test-Path "$Root\schema\roles.local.json") { Get-Content "$Root\schema\roles.local.json" -Raw | ConvertFrom-Json } else { $null }
if ($roles) {
  foreach ($r in $roles.admin, $roles.reader) {
    try { Invoke-RestMethod -Method Post -Headers $H -Uri "$api/appmodules($appId)/appmoduleroles_association/`$ref" -ContentType 'application/json' -Body (@{ '@odata.id' = "$api/roles($r)" } | ConvertTo-Json) | Out-Null } catch { }
  }
  "  roles linked"
}

$validation = Invoke-RestMethod -Headers $H -Uri "$api/ValidateApp(AppModuleId=$appId)"
$issues = $validation.AppValidationResponse.ValidationIssueList | ? { $_.ErrorType -eq 'Error' }
if ($issues) { "  validation errors:"; $issues | % { "    $($_.Message)" } } else { "  app validation ok" }

$xml = "<importexportxml><entities>$(($entities + 'jhrb_heartbeat' | % { "<entity>$_</entity>" }) -join '')</entities><appmodules><appmodule>$appId</appmodule></appmodules><sitemaps><sitemap>$smId</sitemap></sitemaps><webresources><webresource>{$wrId}</webresource></webresources></importexportxml>"
Invoke-RestMethod -Method Post -Headers $H -Uri "$api/PublishXml" -ContentType 'application/json' -Body (@{ ParameterXml = $xml } | ConvertTo-Json) | Out-Null
"published. App: $Org/main.aspx?appid=$appId"
