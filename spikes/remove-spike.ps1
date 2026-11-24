# Removes Phase 0 spike components. Exports the spike log first. Keeps the DefaultUserSettings publisher.
param([string]$Org = $env:DUS_ORG_URL)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\spike-lib.ps1" -Org $Org

$logs = (Invoke-Dv -Path "mus_spikelogs?`$select=mus_name,mus_detail,createdon&`$orderby=createdon asc").value
$logs | ConvertTo-Json -Depth 4 | Set-Content "$PSScriptRoot\..\docs\phase0\spike-log.json" -Encoding utf8
"exported $(@($logs).Count) log rows"

# Remove self from spike team, then delete team
$tid = @((Invoke-Dv -Path "teams?`$select=teamid&`$filter=name eq 'DUS Spike Team'").value)[0].teamid
if ($tid) { Invoke-Dv -Method Delete -Path "teams($tid)" | Out-Null; "team deleted" }

# Steps, type, assembly
foreach ($p in $Steps.PSObject.Properties) { Invoke-Dv -Method Delete -Path "sdkmessageprocessingsteps($($p.Value))" | Out-Null }
"steps deleted"
$type = @((Invoke-Dv -Path "plugintypes?`$select=plugintypeid&`$filter=typename eq 'Mus.SpikeProbe.SpikeProbe'").value)[0].plugintypeid
if ($type) { Invoke-Dv -Method Delete -Path "plugintypes($type)" | Out-Null }
$asm = @((Invoke-Dv -Path "pluginassemblies?`$select=pluginassemblyid&`$filter=name eq 'Mus.SpikeProbe'").value)[0].pluginassemblyid
if ($asm) { $r = Invoke-Dv -Method Delete -Path "pluginassemblies($asm)"; "assembly delete: $($r.Error)" }

# Table
$meta = Invoke-Dv -Path "EntityDefinitions(LogicalName='mus_spikelog')?`$select=MetadataId"
if ($meta.MetadataId) { $r = Invoke-Dv -Method Delete -Path "EntityDefinitions($($meta.MetadataId))"; "table delete: $($r.Error)" }

# Solution container
$sol = @((Invoke-Dv -Path "solutions?`$select=solutionid&`$filter=uniquename eq 'DUSSpike'").value)[0].solutionid
if ($sol) { $r = Invoke-Dv -Method Delete -Path "solutions($sol)"; "solution delete: $($r.Error)" }

# Verify
"remaining: steps=" + @((Invoke-Dv -Path "sdkmessageprocessingsteps?`$select=name&`$filter=startswith(name,'Spike:')").value).Count +
  " asm=" + @((Invoke-Dv -Path "pluginassemblies?`$select=name&`$filter=name eq 'Mus.SpikeProbe'").value).Count +
  " sol=" + @((Invoke-Dv -Path "solutions?`$select=uniquename&`$filter=uniquename eq 'DUSSpike'").value).Count
