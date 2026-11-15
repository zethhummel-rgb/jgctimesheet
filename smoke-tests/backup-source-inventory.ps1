$ErrorActionPreference = "Stop"
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ("jgc-backup-inventory-test-" + [guid]::NewGuid())
$fixture = [System.IO.Path]::GetFullPath($fixture)
if (-not $fixture.StartsWith([System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase)) { throw "Invalid test directory" }
try {
  New-Item -ItemType Directory -Path (Join-Path $fixture "smoke-tests") -Force | Out-Null
  "client.from('jobs').select('*'); client.from('actually_missing').select('*'); Buffer.from('unexpected'); Array.from('characters'); Uint8Array.from('bytes');" | Set-Content -LiteralPath (Join-Path $fixture "app.js") -Encoding UTF8
  "client.from('fake_fixture_table').select('*');" | Set-Content -LiteralPath (Join-Path $fixture "smoke-tests/fixture.js") -Encoding UTF8
  $tokens = $null
  $errors = $null
  $scriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) "backup-jgc-portal.ps1"
  $tree = [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw "Backup script has a syntax error." }
  foreach ($name in @("Get-NormalizedRelativePath", "Test-PortalBackupDirectoryExcluded", "Get-PortalBackupFiles", "Get-PortalSourceInventory")) {
    $fn = $tree.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if ($fn.Count -ne 1) { throw "Missing or duplicate function $name." }
    Invoke-Expression $fn[0].Extent.Text
  }
  $result = Get-PortalSourceInventory -Root $fixture
  if ("jobs" -notin $result.codeReferencedTables -or "actually_missing" -notin $result.codeReferencedTables) { throw "A genuine table reference was missed." }
  if (@($result.codeReferencedTables | Where-Object { $_ -in @("unexpected", "characters", "bytes", "fake_fixture_table") }).Count) { throw "A non-table reference was detected." }
  Write-Output "PASS: real table references are retained and non-table references are excluded."
} finally {
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force }
}
