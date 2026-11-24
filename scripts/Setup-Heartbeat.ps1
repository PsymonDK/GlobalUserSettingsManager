# Daily reconcile without Power Automate (plan section 12): a recurring bulk delete job deletes the jhrb_heartbeat
# row(s) every day; the HeartbeatPlugin (Delete, async) starts the reconcile and creates the next heartbeat row.
# Idempotent: creates the first heartbeat row and the recurring job only if missing.
param(
  [string]$Org = $env:DUS_ORG_URL,
  [string]$StartUtc = (Get-Date).ToUniversalTime().Date.AddDays(1).AddHours(2).ToString('yyyy-MM-ddTHH:mm:ssZ'), # tomorrow 02:00 UTC
  [switch]$RunNow
)
if (-not $Org) { throw 'Pass -Org https://<org>.crm.dynamics.com or set $env:DUS_ORG_URL' }
$ErrorActionPreference = 'Stop'
$api = "$Org/api/data/v9.2"
$tok = az account get-access-token --resource $Org --query accessToken -o tsv
$H = @{ Authorization = "Bearer $tok"; Accept = 'application/json'; 'OData-MaxVersion' = '4.0'; 'OData-Version' = '4.0' }
function Get-Dv($path) { (Invoke-RestMethod -Headers $H -Uri "$api/$path").value }
function Post-Dv($path, $body) {
  try { Invoke-RestMethod -Method Post -Headers $H -Uri "$api/$path" -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 10) }
  catch { throw "POST $path failed: $($_.ErrorDetails.Message)" }
}
$jobName = 'Default User Settings: daily heartbeat'

if (-not (Get-Dv "jhrb_heartbeats?`$select=jhrb_heartbeatid&`$top=1")) { Post-Dv 'jhrb_heartbeats' @{ jhrb_name = 'Heartbeat (initial)' } | Out-Null; "heartbeat row created" }

function BulkDelete($name, $recurrence, $start) {
  Post-Dv 'BulkDelete' @{
    QuerySet = @(@{ '@odata.type' = 'Microsoft.Dynamics.CRM.QueryExpression'; EntityName = 'jhrb_heartbeat'
      ColumnSet = @{ AllColumns = $false; Columns = @('jhrb_heartbeatid') }
      Criteria = @{ FilterOperator = 'And'; Conditions = @(@{ AttributeName = 'createdon'; Operator = 'NotNull'; Values = @() }) } })
    JobName = $name; SendEmailNotification = $false; ToRecipients = @(); CCRecipients = @()
    RecurrencePattern = $recurrence; StartDateTime = $start
  }
}

$existing = Get-Dv "asyncoperations?`$select=asyncoperationid,statecode,recurrencepattern&`$filter=name eq '$jobName' and statecode ne 3"
if (-not $existing) { BulkDelete $jobName 'FREQ=DAILY;INTERVAL=1;' $StartUtc | Out-Null; "recurring bulk delete scheduled daily from $StartUtc" } else { "recurring job exists" }

# Log retention (90 days) is started daily by the HeartbeatPlugin itself (SDK BulkDeleteRequest).

if ($RunNow) { BulkDelete "$jobName (manual run)" '' (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') | Out-Null; "one-off bulk delete started" }
