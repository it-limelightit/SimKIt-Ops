param([switch]$Restart)
$ErrorActionPreference='Stop'
$workspace=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runtime=Join-Path $workspace '.tmp\commissioning-worker'
$envFile=Join-Path $runtime '.env'
if(-not (Test-Path -LiteralPath $envFile)){throw 'Configure the worker first'}
$state=Join-Path $runtime 'process.json'
if(Test-Path -LiteralPath $state){
  $previous=Get-Content -LiteralPath $state -Raw | ConvertFrom-Json
  $existing=Get-Process -Id $previous.pid -ErrorAction SilentlyContinue
  if($existing -and $existing.ProcessName -eq 'node' -and $existing.StartTime.ToUniversalTime().ToString('o') -eq $previous.started){
    if(-not $Restart){Write-Output 'Commissioning worker is already running.';exit 0}
    Stop-Process -Id $existing.Id
    Wait-Process -Id $existing.Id -Timeout 10 -ErrorAction SilentlyContinue
  }
}
$node=(Get-Command node.exe).Source
$worker=Join-Path $workspace 'integrations\commissioning-verifier\worker.mjs'
$process=Start-Process -FilePath $node -ArgumentList @("--env-file=`"$envFile`"","`"$worker`"") -WorkingDirectory $workspace -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $runtime 'worker.log') -RedirectStandardError (Join-Path $runtime 'worker-error.log')
@{pid=$process.Id;started=$process.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $state -Encoding UTF8
Write-Output "Commissioning worker started (PID $($process.Id))."
