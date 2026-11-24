# Registers the Phase 0 spike probe in a DUSSpike solution. Re-runnable: existing components are reused.
param(
  [string]$Org = $env:DUS_ORG_URL,
  [Parameter(Mandatory)] [Guid]$SpikeUserId,
  [string]$Dll = "$PSScriptRoot\SpikeProbe\bin\Release\net462\Mus.SpikeProbe.dll"
)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
$api = "$Org/api/data/v9.2"
$token = az account get-access-token --resource $Org --query accessToken -o tsv
$base = @{ Authorization = "Bearer $token"; Accept = 'application/json'; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0' }
$sol = 'DUSSpike'
function Get-Dv($path) { (Invoke-RestMethod -Headers $base -Uri "$api/$path").value }
function New-Dv($set, $body) {
  $h = $base.Clone(); $h['Prefer'] = 'return=representation'
  if ($set -notin 'publishers', 'solutions') { $h['MSCRM.SolutionUniqueName'] = $sol }
  Invoke-RestMethod -Method Post -Headers $h -Uri "$api/$set" -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 20)))
}
function Label($t) { @{ '@odata.type' = 'Microsoft.Dynamics.CRM.Label'; LocalizedLabels = @(@{ '@odata.type' = 'Microsoft.Dynamics.CRM.LocalizedLabel'; Label = $t; LanguageCode = 1033 }) } }

# Publisher + solution
$pub = Get-Dv "publishers?`$select=publisherid&`$filter=uniquename eq 'DefaultUserSettings'"
if (-not $pub) { $pub = New-Dv 'publishers' @{ uniquename = 'DefaultUserSettings'; friendlyname = 'Default User Settings'; customizationprefix = 'mus'; customizationoptionvalueprefix = 72100 } }
$pubId = @($pub)[0].publisherid
if (-not (Get-Dv "solutions?`$select=solutionid&`$filter=uniquename eq '$sol'")) {
  New-Dv 'solutions' @{ uniquename = $sol; friendlyname = 'DUS Phase 0 Spike'; version = '1.0.0.0'; 'publisherid@odata.bind' = "/publishers($pubId)" } | Out-Null
}

# Log table
$exists = $true
try { Invoke-RestMethod -Headers $base -Uri "$api/EntityDefinitions(LogicalName='mus_spikelog')?`$select=LogicalName" | Out-Null } catch { $exists = $false }
$hasDetail = $exists -and (Get-Dv "EntityDefinitions(LogicalName='mus_spikelog')/Attributes?`$select=LogicalName&`$filter=LogicalName eq 'mus_detail'")
if (-not $exists) {
  New-Dv 'EntityDefinitions' @{
    '@odata.type' = 'Microsoft.Dynamics.CRM.EntityMetadata'; SchemaName = 'mus_SpikeLog'
    DisplayName = Label 'Spike Log'; DisplayCollectionName = Label 'Spike Logs'; Description = Label 'Phase 0 spike diagnostics. Delete after Phase 0.'
    OwnershipType = 'OrganizationOwned'; HasActivities = $false; HasNotes = $false; IsActivity = $false
    Attributes = @(@{ '@odata.type' = 'Microsoft.Dynamics.CRM.StringAttributeMetadata'; SchemaName = 'mus_Name'; IsPrimaryName = $true; MaxLength = 100
      DisplayName = Label 'Name'; RequiredLevel = @{ Value = 'None' }; FormatName = @{ Value = 'Text' } })
  } | Out-Null
}
if (-not $hasDetail) {
  New-Dv "EntityDefinitions(LogicalName='mus_spikelog')/Attributes" @{
    '@odata.type' = 'Microsoft.Dynamics.CRM.MemoAttributeMetadata'; SchemaName = 'mus_Detail'; MaxLength = 100000
    DisplayName = Label 'Detail'; RequiredLevel = @{ Value = 'None' }
  } | Out-Null
}

# Assembly + type
$content = [Convert]::ToBase64String([IO.File]::ReadAllBytes($Dll))
$asm = Get-Dv "pluginassemblies?`$select=pluginassemblyid&`$filter=name eq 'Mus.SpikeProbe'"
if ($asm) {
  $asmId = @($asm)[0].pluginassemblyid
  Invoke-RestMethod -Method Patch -Headers $base -Uri "$api/pluginassemblies($asmId)" -ContentType 'application/json' -Body (@{ content = $content } | ConvertTo-Json) | Out-Null
} else {
  $asmId = (New-Dv 'pluginassemblies' @{ name = 'Mus.SpikeProbe'; content = $content; isolationmode = 2; sourcetype = 0 }).pluginassemblyid
}
$type = Get-Dv "plugintypes?`$select=plugintypeid&`$filter=typename eq 'Mus.SpikeProbe.SpikeProbe'"
$typeId = if ($type) { @($type)[0].plugintypeid } else { (New-Dv 'plugintypes' @{ typename = 'Mus.SpikeProbe.SpikeProbe'; name = 'Mus.SpikeProbe.SpikeProbe'; friendlyname = 'SpikeProbe'; 'pluginassemblyid@odata.bind' = "/pluginassemblies($asmId)" }).plugintypeid }

# Steps
function Msg($name) { @(Get-Dv "sdkmessages?`$select=sdkmessageid&`$filter=name eq '$name'")[0].sdkmessageid }
function Get-MsgFilter($msgId, $entity) { @(Get-Dv "sdkmessagefilters?`$select=sdkmessagefilterid&`$filter=_sdkmessageid_value eq $msgId and primaryobjecttypecode eq '$entity'")[0].sdkmessagefilterid }
$cfg = "onlyuser=$SpikeUserId`ntiming=true"
$steps = @(
  @{ n = 'Spike: usersettings Update Pre';   m = 'Update';       e = 'usersettings'; s = 20; mode = 0; cfg = $cfg },
  @{ n = 'Spike: usersettings Update Post';  m = 'Update';       e = 'usersettings'; s = 40; mode = 0; cfg = "onlyuser=$SpikeUserId" },
  @{ n = 'Spike: systemuser Create Post';    m = 'Create';       e = 'systemuser';   s = 40; mode = 0; cfg = 'checksettings=true' },
  @{ n = 'Spike: systemuser Update Post BU'; m = 'Update';       e = 'systemuser';   s = 40; mode = 1; cfg = "onlyuser=$SpikeUserId"; fa = 'businessunitid' },
  @{ n = 'Spike: Associate Post';            m = 'Associate';    e = 'none';         s = 40; mode = 0; cfg = "onlyuser=$SpikeUserId" },
  @{ n = 'Spike: Disassociate Post';         m = 'Disassociate'; e = 'none';         s = 40; mode = 0; cfg = "onlyuser=$SpikeUserId" }
)
$out = @{}
foreach ($s in $steps) {
  $existing = Get-Dv "sdkmessageprocessingsteps?`$select=sdkmessageprocessingstepid&`$filter=name eq '$($s.n)'"
  if ($existing) { $out[$s.n] = @($existing)[0].sdkmessageprocessingstepid; continue }
  $msgId = Msg $s.m
  $body = @{
    name = $s.n; stage = $s.s; mode = $s.mode; rank = 1; supporteddeployment = 0; invocationsource = 0; asyncautodelete = $false
    configuration = $s.cfg
    'plugintypeid@odata.bind' = "/plugintypes($typeId)"; 'sdkmessageid@odata.bind' = "/sdkmessages($msgId)"
  }
  $f = Get-MsgFilter $msgId $s.e
  if ($f) { $body['sdkmessagefilterid@odata.bind'] = "/sdkmessagefilters($f)" }
  if ($s.fa) { $body['filteringattributes'] = $s.fa }
  $out[$s.n] = (New-Dv 'sdkmessageprocessingsteps' $body).sdkmessageprocessingstepid
}
$out | ConvertTo-Json | Set-Content "$PSScriptRoot\spike-steps.json" -Encoding utf8
"Registered: assembly $asmId, type $typeId"
$out
