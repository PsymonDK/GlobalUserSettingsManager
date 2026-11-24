# Reads type details (string length, int range, picklist options, lookup targets) for the managed settings
# and writes schema/usersettings-metadata.json. Read-only against Dataverse.
param(
  [string]$Org = $env:DUS_ORG_URL,
  [string]$Out = "$PSScriptRoot\..\schema\usersettings-metadata.json"
)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
$tok = az account get-access-token --resource $Org --query accessToken -o tsv
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/json' }
$api = "$Org/api/data/v9.2/EntityDefinitions(LogicalName='usersettings')/Attributes"
function Get-Cast($cast, $select, $expand) {
  $u = "$api/Microsoft.Dynamics.CRM.$cast`?`$select=$select"; if ($expand) { $u += "&`$expand=$expand" }
  (Invoke-RestMethod -Headers $H -Uri $u).value
}
$result = [ordered]@{}
Get-Cast 'StringAttributeMetadata' 'LogicalName,MaxLength' | % { $result[$_.LogicalName] = @{ type = 'String'; maxLength = $_.MaxLength } }
Get-Cast 'IntegerAttributeMetadata' 'LogicalName,MinValue,MaxValue' | % { $result[$_.LogicalName] = @{ type = 'Integer'; min = $_.MinValue; max = $_.MaxValue } }
Get-Cast 'BooleanAttributeMetadata' 'LogicalName' | % { $result[$_.LogicalName] = @{ type = 'Boolean' } }
Get-Cast 'LookupAttributeMetadata' 'LogicalName,Targets' | % { $result[$_.LogicalName] = @{ type = 'Lookup'; targets = $_.Targets } }
Get-Cast 'PicklistAttributeMetadata' 'LogicalName' 'OptionSet($select=Options)' | % {
  $opts = $_.OptionSet.Options | % { @{ value = $_.Value; label = $_.Label.UserLocalizedLabel.Label } }
  $result[$_.LogicalName] = @{ type = 'Picklist'; options = @($opts) }
}
(Invoke-RestMethod -Headers $H -Uri "$api`?`$select=LogicalName,AttributeType&`$filter=AttributeType eq Microsoft.Dynamics.CRM.AttributeTypeCode'Uniqueidentifier'").value |
  % { $result[$_.LogicalName] = @{ type = 'Uniqueidentifier' } }
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
$result | ConvertTo-Json -Depth 6 | Set-Content $Out -Encoding utf8
"wrote $($result.Count) attributes to $Out"
