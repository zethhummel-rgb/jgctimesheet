param(
    [string]$PortalRoot = $PSScriptRoot,
    [switch]$Headed
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-NodeExecutable {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    foreach ($candidate in @(
        (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
        "C:\Program Files\nodejs\node.exe"
    )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    return $null
}

$PortalRoot = (Resolve-Path -LiteralPath $PortalRoot).Path
$node = Resolve-NodeExecutable
if (-not $node) {
    Write-Host "[FAIL] Node.js was not found. Install Node.js 22 or newer before running browser smoke tests." -ForegroundColor Red
    exit 1
}

$playwrightCli = Join-Path $PortalRoot "node_modules\@playwright\test\cli.js"
if (-not (Test-Path -LiteralPath $playwrightCli -PathType Leaf)) {
    Write-Host "[FAIL] Playwright is not installed." -ForegroundColor Red
    Write-Host "Run npm install and then npm run smoke:install from:" -ForegroundColor Yellow
    Write-Host $PortalRoot -ForegroundColor Yellow
    exit 1
}

Write-Host "JGC Portal browser smoke tests" -ForegroundColor Cyan
Write-Host ("Portal: {0}" -f $PortalRoot)
Write-Host ""

$env:PATH = (Split-Path -Parent $node) + ";" + $env:PATH
$portListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$portListener.Start()
$smokePort = ([System.Net.IPEndPoint]$portListener.LocalEndpoint).Port
$portListener.Stop()
$env:JGC_SMOKE_PORT = [string]$smokePort

$serverProcess = Start-Process `
    -FilePath $node `
    -ArgumentList @("smoke-tests\static-server.js", "--port", [string]$smokePort) `
    -WorkingDirectory $PortalRoot `
    -PassThru `
    -WindowStyle Hidden

$serverReady = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ($serverProcess.HasExited) {
        break
    }

    try {
        $response = Invoke-WebRequest -Uri ("http://127.0.0.1:{0}/index.html" -f $smokePort) -UseBasicParsing -TimeoutSec 1
        if ($response.StatusCode -eq 200) {
            $serverReady = $true
            break
        }
    } catch {
        Start-Sleep -Milliseconds 100
    }
}

if (-not $serverReady) {
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    Write-Host "[FAIL] The local JGC smoke-test server could not start." -ForegroundColor Red
    exit 1
}

$arguments = @($playwrightCli, "test", "--config=playwright.config.js")
if ($Headed) {
    $arguments += "--headed"
}

Push-Location $PortalRoot
try {
    & $node @arguments
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
    Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
}

if ($exitCode -ne 0) {
    Write-Host "Browser smoke tests failed. Review the first failing page or action above." -ForegroundColor Red
    exit $exitCode
}

Write-Host "Browser smoke tests passed." -ForegroundColor Green
exit 0
