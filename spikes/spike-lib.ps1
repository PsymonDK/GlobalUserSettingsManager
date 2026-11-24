# Dot-source: . .\spike-lib.ps1 -Org <url>
param([string]$Org = $env:DUS_ORG_URL)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$script:api = "$Org/api/data/v9.2"
$script:tok = az account get-access-token --resource $Org --query accessToken -o tsv
$script:H = @{ Authorization = "Bearer $tok"; Accept = 'application/json'; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0' }
$script:Me = (Invoke-RestMethod -Headers $H -Uri "$api/WhoAmI").UserId
$script:Steps = Get-Content "$PSScriptRoot\spike-steps.json" -Raw | ConvertFrom-Json

function Invoke-Dv([string]$Method = 'Get', [string]$Path, $Body) {
  $p = @{ Method = $Method; Headers = $H; Uri = "$api/$Path" }
  if ($Body) { $p.ContentType = 'application/json'; $p.Body = ($Body | ConvertTo-Json -Depth 10) }
  try { Invoke-RestMethod @p } catch {
    $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
    [pscustomobject]@{ Error = $msg }
  }
}
function Set-StepConfig([string]$Name, [string]$Config) {
  $id = $Steps.$Name
  Invoke-Dv -Method Patch -Path "sdkmessageprocessingsteps($id)" -Body @{ configuration = $Config } | Out-Null
}
function Get-MySettings([string]$Select = 'paginglimit,timezonecode,showweeknumber,modifiedon') {
  Invoke-Dv -Path "usersettingscollection($Me)?`$select=$Select"
}
function Set-MySettings([hashtable]$Values) { Invoke-Dv -Method Patch -Path "usersettingscollection($Me)" -Body $Values }
function Get-SpikeLog([datetime]$Since) {
  $s = $Since.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  (Invoke-Dv -Path "mus_spikelogs?`$select=mus_name,mus_detail,createdon&`$filter=createdon ge $s&`$orderby=createdon asc").value |
    ForEach-Object { "==== $($_.createdon) $($_.mus_name)`n$($_.mus_detail)" }
}
function Clear-SpikeLog { (Invoke-Dv -Path "mus_spikelogs?`$select=mus_spikelogid").value | % { Invoke-Dv -Method Delete -Path "mus_spikelogs($($_.mus_spikelogid))" | Out-Null } }
