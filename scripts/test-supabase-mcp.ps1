$ErrorActionPreference = 'Stop'
$previousUrl = $env:SIMKIT_MCP_URL
$previousToken = $env:SIMKIT_MCP_TOKEN
$secureToken = $null
$tokenPointer = [IntPtr]::Zero
try {
    do {
        $env:SIMKIT_MCP_URL = (Read-Host 'Paste your hosted Supabase project URL or project-scoped MCP URL').Trim()
        if ([string]::IsNullOrWhiteSpace($env:SIMKIT_MCP_URL)) {
            Write-Host 'The URL is required. Paste it before pressing Enter.' -ForegroundColor Yellow
            continue
        }
        & node (Join-Path $PSScriptRoot 'test-supabase-mcp.mjs') --validate-url
        $urlValid = $LASTEXITCODE -eq 0
    } while ([string]::IsNullOrWhiteSpace($env:SIMKIT_MCP_URL) -or -not $urlValid)
    $secureToken = Read-Host 'Paste your Supabase personal access token (hidden)' -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $env:SIMKIT_MCP_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer).Trim()
    & node (Join-Path $PSScriptRoot 'test-supabase-mcp.mjs')
    $testExitCode = $LASTEXITCODE
} finally {
    $env:SIMKIT_MCP_URL = $previousUrl
    $env:SIMKIT_MCP_TOKEN = $previousToken
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    if ($null -ne $secureToken) { $secureToken.Dispose() }
}
if ($testExitCode -ne 0) { throw 'Supabase MCP connection test did not pass.' }
