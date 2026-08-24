param(
  [string]$PortalRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [string]$BackupRoot = "",
  [int]$RetentionDays = 90,
  [string]$CredentialPath = (Join-Path $env:LOCALAPPDATA "JGC Portal Backup\credentials.json"),
  [switch]$ConfigureCredential
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$script:BackupUserAgent = "JGC-Portal-Backup/2.0"
$script:RedactionKey = ""
$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:EphemeralStorageBuckets = @("digital-po-temp")

function Write-Step($Message) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
}

function Write-Utf8Text($Path, $Value) {
  [System.IO.File]::WriteAllText($Path, [string]$Value, $script:Utf8NoBom)
}

function Write-JsonFile($Path, $Value) {
  $json = ConvertTo-Json -InputObject $Value -Depth 100
  Write-Utf8Text -Path $Path -Value $json
}

function Get-SafeErrorMessage($ErrorValue) {
  $message = if ($ErrorValue -is [System.Management.Automation.ErrorRecord]) {
    $ErrorValue.Exception.Message
  } elseif ($ErrorValue -is [System.Exception]) {
    $ErrorValue.Message
  } else {
    [string]$ErrorValue
  }

  if ($script:RedactionKey) {
    $message = $message -replace [regex]::Escape($script:RedactionKey), "[REDACTED]"
  }

  if ($message.Length -gt 700) {
    return $message.Substring(0, 700)
  }

  return $message
}

function Get-NormalizedRelativePath($Root, $Path) {
  return $Path.Substring($Root.Length).TrimStart("\", "/") -replace "\\", "/"
}

function Test-PortalBackupDirectoryExcluded($Name) {
  $excludedNames = @(
    ".git", ".agents", ".codex", ".pnpm-store", "node_modules",
    "JGC Portal Backups", "tmp", "temp", "output", "outputs"
  )

  if ($Name -in $excludedNames) {
    return $true
  }

  return $Name.StartsWith(".codex-", [StringComparison]::OrdinalIgnoreCase)
}

function Get-PortalBackupFiles($Root) {
  $rootDirectory = Get-Item -LiteralPath $Root
  $pendingDirectories = [System.Collections.Generic.Stack[System.IO.DirectoryInfo]]::new()
  $pendingDirectories.Push($rootDirectory)

  while ($pendingDirectories.Count -gt 0) {
    $directory = $pendingDirectories.Pop()
    foreach ($item in @(Get-ChildItem -LiteralPath $directory.FullName -Force -ErrorAction Stop)) {
      if ($item.PSIsContainer) {
        if (-not (Test-PortalBackupDirectoryExcluded -Name $item.Name)) {
          $pendingDirectories.Push($item)
        }
        continue
      }

      Write-Output $item
    }
  }
}

function Get-FileSha256($Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-EncodedStoragePath($Path) {
  return (($Path -split "/") | ForEach-Object { [uri]::EscapeDataString($_) }) -join "/"
}

function Save-ProtectedCredential($Path, $SupabaseUrl, [Security.SecureString]$SecretKey) {
  if (-not $SupabaseUrl -or -not $SecretKey) {
    throw "Both the Supabase URL and secret key are required."
  }

  $directory = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $directory -Force | Out-Null

  $record = [ordered]@{
    formatVersion = 1
    supabaseUrl = $SupabaseUrl.TrimEnd("/")
    protectedSecretKey = ConvertFrom-SecureString -SecureString $SecretKey
    createdAt = (Get-Date).ToString("o")
    protection = "Windows DPAPI CurrentUser"
  }

  Write-JsonFile -Path $Path -Value $record
}

function Configure-BackupCredential($Path) {
  Write-Host "Configure the local JGC Portal backup credential."
  Write-Host "The key will be encrypted with Windows DPAPI for this Windows account."
  $url = Read-Host "Supabase project URL"
  $key = Read-Host "Supabase secret key (input is hidden)" -AsSecureString
  Save-ProtectedCredential -Path $Path -SupabaseUrl $url -SecretKey $key
  Write-Host "Credential saved securely at $Path"
  Write-Host "No key was written to the portal folder."
}

function Get-BackupCredential($Path, $Root) {
  $environmentUrl = [Environment]::GetEnvironmentVariable("JGC_SUPABASE_URL", "Process")
  $environmentKey = [Environment]::GetEnvironmentVariable("JGC_SUPABASE_SECRET_KEY", "Process")

  if ($environmentUrl -or $environmentKey) {
    if (-not $environmentUrl -or -not $environmentKey) {
      throw "JGC_SUPABASE_URL and JGC_SUPABASE_SECRET_KEY must both be set when environment credentials are used."
    }

    return [pscustomobject]@{
      url = $environmentUrl.TrimEnd("/")
      key = $environmentKey
      source = "process environment"
    }
  }

  if (Test-Path -LiteralPath $Path) {
    $record = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    if (-not $record.supabaseUrl -or -not $record.protectedSecretKey) {
      throw "The protected backup credential is incomplete. Run this script with -ConfigureCredential."
    }

    $secureKey = ConvertTo-SecureString -String ([string]$record.protectedSecretKey)
    $plainKey = (New-Object System.Net.NetworkCredential("", $secureKey)).Password
    return [pscustomobject]@{
      url = ([string]$record.supabaseUrl).TrimEnd("/")
      key = $plainKey
      source = "Windows DPAPI credential"
    }
  }

  $legacyPath = Join-Path $Root "backup-secrets.json"
  if (Test-Path -LiteralPath $legacyPath) {
    throw "Plaintext backup-secrets.json is no longer accepted. Run this script with -ConfigureCredential, then remove backup-secrets.json."
  }

  throw "No backup credential is configured. Run this script with -ConfigureCredential."
}

function Get-SupabaseHeaders($Key, [switch]$Json) {
  $headers = @{
    apikey = $Key
    "User-Agent" = $script:BackupUserAgent
    Accept = "application/json"
  }

  if ($Key -match "^eyJ" -and $Key -match "\.") {
    $headers.Authorization = "Bearer $Key"
  }

  if ($Json) {
    $headers["Content-Type"] = "application/json"
  }

  return $headers
}

function Get-WebResponseText($Response) {
  if ($Response.Content -is [byte[]]) {
    return [Text.Encoding]::UTF8.GetString($Response.Content)
  }

  return [string]$Response.Content
}

function ConvertFrom-JsonItems($Json) {
  if ([string]::IsNullOrWhiteSpace($Json)) {
    return
  }

  $value = ConvertFrom-Json -InputObject $Json
  if ($value -is [System.Array]) {
    foreach ($item in $value) {
      Write-Output $item
    }
  } elseif ($null -ne $value) {
    Write-Output $value
  }
}

function Invoke-SupabaseJson($Uri, $Key, $Method = "Get", $Body = $null) {
  $headers = Get-SupabaseHeaders -Key $Key -Json:($null -ne $Body)
  if ($null -ne $Body) {
    $bodyJson = ConvertTo-Json -InputObject $Body -Depth 30
    $response = Invoke-WebRequest -Uri $Uri -Method $Method -Headers $headers -Body $bodyJson -UseBasicParsing
  } else {
    $response = Invoke-WebRequest -Uri $Uri -Method $Method -Headers $headers -UseBasicParsing
  }

  $responseText = Get-WebResponseText -Response $response
  if ([string]::IsNullOrWhiteSpace($responseText)) {
    return $null
  }

  ConvertFrom-JsonItems -Json $responseText
}

function Write-BackupDiagnostic($Url, $Key, $Severity, $EventType, $Message, $Details = $null) {
  try {
    $detailValue = if ($null -ne $Details) { $Details } else { @{} }
    $payload = [ordered]@{
      client_event_id = "backup-" + [guid]::NewGuid().ToString()
      occurred_at = (Get-Date).ToString("o")
      severity = $Severity
      category = "backup"
      event_type = $EventType
      source = "backup-jgc-portal.ps1"
      message = $Message
      details = $detailValue
      profile_id = $null
      actor_name = $env:USERNAME
      page_url = ""
      record_table = ""
      record_id = ""
      related_url = "admin.html?tab=backups"
    }
    Invoke-SupabaseJson -Uri "$Url/rest/v1/portal_diagnostics" -Key $Key -Method Post -Body $payload | Out-Null
  } catch {
    Write-Step ("Diagnostics note could not be uploaded: " + (Get-SafeErrorMessage $_))
  }
}

function Test-SupabasePreflight($Url, $Key) {
  if (-not $Url -or $Url -notmatch "^https://[a-z0-9-]+\.supabase\.co$") {
    throw "The Supabase URL is missing or invalid."
  }

  if (-not $Key) {
    throw "The Supabase secret credential is missing."
  }

  $headers = Get-SupabaseHeaders -Key $Key
  $headers.Accept = "application/openapi+json, application/json"
  $schemaResponse = Invoke-WebRequest -Uri "$Url/rest/v1/" -Method Get -Headers $headers -UseBasicParsing
  $schema = (Get-WebResponseText -Response $schemaResponse) | ConvertFrom-Json
  $definitions = @($schema.definitions.PSObject.Properties.Name | Sort-Object -Unique)

  if ($definitions.Count -eq 0) {
    throw "Authentication succeeded but the public Data API schema returned no objects."
  }

  $bucketResponse = Invoke-WebRequest -Uri "$Url/storage/v1/bucket" -Method Get -Headers (Get-SupabaseHeaders -Key $Key) -UseBasicParsing
  $bucketValue = @(ConvertFrom-JsonItems -Json (Get-WebResponseText -Response $bucketResponse))
  $bucketList = [System.Collections.Generic.List[object]]::new()
  foreach ($bucket in $bucketValue) {
    $bucketList.Add($bucket)
  }

  return [pscustomobject]@{
    schema = $schema
    databaseObjects = $definitions
    buckets = $bucketList.ToArray()
  }
}

function Get-PortalSourceInventory($Root) {
  $tableNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $bucketNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $sqlNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $sourcePattern = '\.from\(\s*["'']([a-zA-Z0-9_]+)["'']\s*\)'
  $bucketPattern = '\.storage\.from\(\s*["'']([a-zA-Z0-9_-]+)["'']\s*\)'
  $sqlPattern = '(?im)\b(?:create\s+table(?:\s+if\s+not\s+exists)?|alter\s+table(?:\s+if\s+exists)?|references)\s+(?:public\.)?["'']?([a-z_][a-z0-9_]*)'
  foreach ($file in Get-PortalBackupFiles -Root $Root) {
    $relative = Get-NormalizedRelativePath -Root $Root -Path $file.FullName
    $extension = $file.Extension.ToLowerInvariant()
    if ($extension -in @(".html", ".js", ".ts")) {
      $content = Get-Content -LiteralPath $file.FullName -Raw
      foreach ($match in [regex]::Matches($content, $sourcePattern)) {
        [void]$tableNames.Add($match.Groups[1].Value)
      }
      foreach ($match in [regex]::Matches($content, $bucketPattern)) {
        [void]$bucketNames.Add($match.Groups[1].Value)
      }
    } elseif ($extension -eq ".sql") {
      $content = Get-Content -LiteralPath $file.FullName -Raw
      foreach ($match in [regex]::Matches($content, $sqlPattern)) {
        [void]$sqlNames.Add($match.Groups[1].Value)
      }
    }
  }

  return [pscustomobject]@{
    codeReferencedTables = @($tableNames | Sort-Object)
    sqlReferencedNames = @($sqlNames | Sort-Object)
    codeReferencedBuckets = @($bucketNames | Sort-Object)
  }
}

function Export-SupabaseTable($Url, $Key, $TableName, $OutputDirectory) {
  $pageSize = 1000
  $offset = 0
  $pageCount = 0
  $expectedTotal = $null
  $rows = [System.Collections.Generic.List[object]]::new()

  while ($true) {
    $headers = Get-SupabaseHeaders -Key $Key
    $headers["Prefer"] = "count=exact"
    $tablePath = [uri]::EscapeDataString($TableName)
    $response = Invoke-WebRequest -Uri "$Url/rest/v1/$tablePath`?select=*&limit=$pageSize&offset=$offset" -Method Get -Headers $headers -UseBasicParsing
    $pageCount++

    if ($null -eq $expectedTotal) {
      $contentRange = [string]$response.Headers["Content-Range"]
      if ($contentRange -notmatch "/(\d+)$") {
        throw "Supabase did not return an exact row count for $TableName."
      }
      $expectedTotal = [int64]$matches[1]
    }

    $responseText = Get-WebResponseText -Response $response
    $batch = @(ConvertFrom-JsonItems -Json $responseText)
    foreach ($row in $batch) {
      if ($null -ne $row) {
        $rows.Add($row)
      }
    }

    $offset += $batch.Count
    if ($batch.Count -eq 0 -or $offset -ge $expectedTotal) {
      break
    }
    if ($batch.Count -lt $pageSize) {
      throw "Pagination stopped early for $TableName at $offset of $expectedTotal rows."
    }
  }

  if ($rows.Count -ne $expectedTotal) {
    throw "Row count mismatch for ${TableName}: downloaded $($rows.Count), expected $expectedTotal."
  }

  $outputPath = Join-Path $OutputDirectory ($TableName + ".json")
  $rowArray = if ($rows.Count -eq 0) { @() } else { $rows.ToArray() }
  Write-JsonFile -Path $outputPath -Value $rowArray

  try {
    $validated = @(ConvertFrom-JsonItems -Json (Get-Content -LiteralPath $outputPath -Raw))
  } catch {
    throw "Exported JSON for $TableName is malformed."
  }

  if ($validated.Count -ne $rows.Count) {
    throw "JSON verification failed for ${TableName}: file contains $($validated.Count) rows, expected $($rows.Count)."
  }

  $file = Get-Item -LiteralPath $outputPath
  return [pscustomobject]@{
    table = $TableName
    rows = $rows.Count
    expectedRows = $expectedTotal
    pages = $pageCount
    bytes = $file.Length
    sha256 = Get-FileSha256 -Path $outputPath
    file = "supabase/tables/$TableName.json"
    status = if ($rows.Count -eq 0) { "EMPTY" } else { "EXPORTED" }
    error = ""
  }
}

function Get-SupabaseStorageObjects($Url, $Key, $BucketName, $Prefix = "", $Visited = $null) {
  if ($null -eq $Visited) {
    $Visited = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  }

  if (-not $Visited.Add($Prefix)) {
    return @()
  }

  $objects = [System.Collections.Generic.List[object]]::new()
  $offset = 0
  $limit = 1000

  do {
    $body = [ordered]@{
      prefix = $Prefix
      limit = $limit
      offset = $offset
      sortBy = @{ column = "name"; order = "asc" }
    }
    $uri = "$Url/storage/v1/object/list/$([uri]::EscapeDataString($BucketName))"
    $result = Invoke-SupabaseJson -Uri $uri -Key $Key -Method "Post" -Body $body
    $batch = @($result)

    foreach ($item in $batch) {
      if ($null -eq $item -or -not $item.name) {
        continue
      }

      $path = if ($Prefix) { "$Prefix/$($item.name)" } else { [string]$item.name }
      $isFile = ($item.PSObject.Properties.Name -contains "id" -and $item.id) -or
        ($item.PSObject.Properties.Name -contains "metadata" -and $null -ne $item.metadata)

      if ($isFile) {
        $size = $null
        if ($item.metadata -and $item.metadata.PSObject.Properties.Name -contains "size") {
          $size = [int64]$item.metadata.size
        }
        $objects.Add([pscustomobject]@{ path = $path; expectedBytes = $size })
      } else {
        foreach ($child in @(Get-SupabaseStorageObjects -Url $Url -Key $Key -BucketName $BucketName -Prefix $path -Visited $Visited)) {
          $objects.Add($child)
        }
      }
    }

    $offset += $limit
  } while ($batch.Count -eq $limit)

  return $objects.ToArray()
}

function Backup-SupabaseStorageBucket($Url, $Key, $BucketName, $OutputDirectory) {
  $bucketDirectory = Join-Path $OutputDirectory $BucketName
  New-Item -ItemType Directory -Path $bucketDirectory -Force | Out-Null
  $objects = @(Get-SupabaseStorageObjects -Url $Url -Key $Key -BucketName $BucketName)
  $inventory = [System.Collections.Generic.List[object]]::new()
  $failures = [System.Collections.Generic.List[object]]::new()
  $copied = 0
  $totalBytes = [int64]0

  foreach ($object in $objects) {
    try {
      $relativePath = $object.path -replace "/", [System.IO.Path]::DirectorySeparatorChar
      $targetPath = Join-Path $bucketDirectory $relativePath
      New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
      $encodedPath = Get-EncodedStoragePath $object.path
      $uri = "$Url/storage/v1/object/$([uri]::EscapeDataString($BucketName))/$encodedPath"
      Invoke-WebRequest -Uri $uri -Method Get -Headers (Get-SupabaseHeaders -Key $Key) -OutFile $targetPath -UseBasicParsing | Out-Null
      $file = Get-Item -LiteralPath $targetPath

      if ($null -ne $object.expectedBytes -and $file.Length -ne $object.expectedBytes) {
        throw "Downloaded size $($file.Length) does not match expected size $($object.expectedBytes)."
      }

      $copied++
      $totalBytes += $file.Length
      $inventory.Add([pscustomobject]@{
        bucket = $BucketName
        path = $object.path
        bytes = $file.Length
        sha256 = Get-FileSha256 -Path $targetPath
        file = "supabase/storage/$BucketName/$($object.path)"
      })
    } catch {
      $failures.Add([pscustomobject]@{ path = $object.path; error = Get-SafeErrorMessage $_ })
    }
  }

  $status = if ($failures.Count -gt 0 -or $copied -ne $objects.Count) {
    "FAILED"
  } elseif ($copied -eq 0) {
    "EMPTY"
  } else {
    "COPIED"
  }

  return [pscustomobject]@{
    summary = [pscustomobject]@{
      bucket = $BucketName
      filesDiscovered = $objects.Count
      files = $copied
      bytes = $totalBytes
      failedFiles = $failures.Count
      status = $status
      error = if ($failures.Count) { "$($failures.Count) file(s) failed to download or verify." } else { "" }
      failures = $failures.ToArray()
    }
    inventory = $inventory.ToArray()
  }
}

function Test-TextFileForSecret($Path) {
  $textExtensions = @(".bat", ".cmd", ".css", ".html", ".js", ".json", ".md", ".ps1", ".sql", ".txt", ".xml", ".yml", ".yaml")
  $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  if ($extension -notin $textExtensions -or (Get-Item -LiteralPath $Path).Length -gt 5242880) {
    return $false
  }

  $content = Get-Content -LiteralPath $Path -Raw
  if ($content -match 'sb_secret_[A-Za-z0-9_-]{20,}') {
    return $true
  }

  foreach ($token in [regex]::Matches($content, 'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}')) {
    try {
      $parts = $token.Value -split '\.'
      $payload = $parts[1].Replace('-', '+').Replace('_', '/')
      while ($payload.Length % 4) { $payload += '=' }
      $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
      if ([string]$json.role -eq "service_role") {
        return $true
      }
    } catch {
    }
  }

  return $false
}

function Copy-PortalWebsite($Root, $Destination) {
  $excludedNames = @("backup-secrets.json", "credentials.json")
  $sensitiveExtensions = @(".key", ".pem", ".pfx", ".p12")
  $inventory = [System.Collections.Generic.List[object]]::new()
  $failures = [System.Collections.Generic.List[object]]::new()
  $bytes = [int64]0

  foreach ($file in Get-PortalBackupFiles -Root $Root) {
    $relative = Get-NormalizedRelativePath -Root $Root -Path $file.FullName
    if ($excludedNames -contains $file.Name -or $file.Name -like ".env*" -or $sensitiveExtensions -contains $file.Extension.ToLowerInvariant()) {
      continue
    }
    if (Test-TextFileForSecret -Path $file.FullName) {
      $failures.Add([pscustomobject]@{ file = $relative; error = "Potential elevated Supabase credential detected; file was not copied." })
      continue
    }

    $targetPath = Join-Path $Destination ($relative -replace "/", [System.IO.Path]::DirectorySeparatorChar)
    New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $targetPath -Force
    $bytes += $file.Length
    $inventory.Add([pscustomobject]@{
      path = $relative
      bytes = $file.Length
      sha256 = Get-FileSha256 -Path $targetPath
      file = "website-files/$relative"
    })
  }

  $required = @("index.html", "admin.html", "common.js", "service-worker.js", "styles.css", "backup-jgc-portal.ps1")
  foreach ($requiredFile in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $Destination $requiredFile))) {
      $failures.Add([pscustomobject]@{ file = $requiredFile; error = "Required website file is missing from the backup." })
    }
  }

  if ($inventory.Count -lt 10 -or $bytes -lt 102400) {
    $failures.Add([pscustomobject]@{ file = "website-files"; error = "Website backup is suspiciously small." })
  }

  return [pscustomobject]@{
    status = if ($failures.Count) { "FAILED" } else { "PASSED" }
    files = $inventory.Count
    bytes = $bytes
    failures = $failures.ToArray()
    inventory = $inventory.ToArray()
  }
}

function Get-ZipEntryMap($Archive) {
  $map = @{}
  foreach ($entry in $Archive.Entries) {
    $name = ($entry.FullName -replace "\\", "/").ToLowerInvariant()
    $map[$name] = $entry
  }
  return $map
}

function Read-ZipText($Entry) {
  $reader = New-Object System.IO.StreamReader($Entry.Open())
  try {
    return $reader.ReadToEnd()
  } finally {
    $reader.Dispose()
  }
}

function Test-BackupArchive($ZipPath) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $errors = [System.Collections.Generic.List[string]]::new()
  $checks = [System.Collections.Generic.List[object]]::new()
  $zipFile = Get-Item -LiteralPath $ZipPath

  if ($zipFile.Length -lt 102400) {
    $errors.Add("Backup ZIP is suspiciously small ($($zipFile.Length) bytes).")
  }

  $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $entries = Get-ZipEntryMap -Archive $archive
    $requiredEntries = @(
      "backup-manifest.json",
      "backup-summary.txt",
      "restore-readiness.json",
      "website-file-inventory.json",
      "website-files/index.html",
      "supabase/schema/openapi.json",
      "supabase/table-export-summary.json",
      "supabase/table-inventory-comparison.json",
      "supabase/storage-export-summary.json",
      "supabase/storage-file-inventory.json"
    )

    foreach ($requiredEntry in $requiredEntries) {
      if (-not $entries.ContainsKey($requiredEntry)) {
        $errors.Add("Missing required ZIP entry: $requiredEntry")
      }
    }

    foreach ($entryName in $entries.Keys) {
      if ($entryName -match '(^|/)(backup-secrets\.json|credentials\.json|\.env(?:\.|$))') {
        $errors.Add("Sensitive configuration file found in ZIP: $entryName")
      }
    }

    if ($entries.ContainsKey("backup-manifest.json")) {
      try {
        $manifest = Read-ZipText $entries["backup-manifest.json"] | ConvertFrom-Json
        if ($manifest.overallStatus -ne "PASSED") {
          $errors.Add("Manifest overall status is $($manifest.overallStatus).")
        }
      } catch {
        $errors.Add("backup-manifest.json is not valid JSON.")
      }
    }

    if ($entries.ContainsKey("supabase/table-export-summary.json")) {
      try {
        $tableSummary = @(ConvertFrom-JsonItems -Json (Read-ZipText $entries["supabase/table-export-summary.json"]))
        foreach ($table in $tableSummary) {
          if ($table.status -notin @("EXPORTED", "EMPTY")) {
            $errors.Add("Database object $($table.table) has status $($table.status).")
            continue
          }
          $entryName = ([string]$table.file).ToLowerInvariant()
          if (-not $entries.ContainsKey($entryName)) {
            $errors.Add("Missing table export file: $entryName")
            continue
          }
          try {
            $rows = @(ConvertFrom-JsonItems -Json (Read-ZipText $entries[$entryName]))
            if ($rows.Count -ne [int64]$table.rows) {
              $errors.Add("Row count mismatch inside ZIP for $($table.table).")
            }
          } catch {
            $errors.Add("Malformed JSON inside ZIP for $($table.table).")
          }
        }
      } catch {
        $errors.Add("Table export summary is not valid JSON.")
      }
    }

    foreach ($inventoryFile in @("website-file-inventory.json", "supabase/storage-file-inventory.json")) {
      if (-not $entries.ContainsKey($inventoryFile)) {
        continue
      }
      try {
        $inventory = @(ConvertFrom-JsonItems -Json (Read-ZipText $entries[$inventoryFile]))
        foreach ($item in $inventory) {
          $entryName = ([string]$item.file).ToLowerInvariant()
          if (-not $entries.ContainsKey($entryName)) {
            $errors.Add("Inventory file is missing from ZIP: $entryName")
          } elseif ($entries[$entryName].Length -ne [int64]$item.bytes) {
            $errors.Add("Size mismatch inside ZIP: $entryName")
          }
        }
      } catch {
        $errors.Add("$inventoryFile is not valid JSON.")
      }
    }

    $checks.Add([pscustomobject]@{ check = "Required folders and reports"; status = if ($errors.Count) { "FAIL" } else { "PASS" } })
  } finally {
    $archive.Dispose()
  }

  return [pscustomobject]@{
    validatedAt = (Get-Date).ToString("o")
    status = if ($errors.Count) { "FAIL" } else { "PASS" }
    archive = $ZipPath
    archiveSizeBytes = $zipFile.Length
    errors = $errors.ToArray()
    checks = $checks.ToArray()
  }
}

if ($ConfigureCredential) {
  Configure-BackupCredential -Path $CredentialPath
  exit 0
}

$PortalRoot = (Resolve-Path -LiteralPath $PortalRoot).Path
$credential = Get-BackupCredential -Path $CredentialPath -Root $PortalRoot
$script:RedactionKey = [string]$credential.key

Write-Step "Running Supabase authentication and schema preflight..."
$unhandledBackupFailure = $false
try {
  $preflight = Test-SupabasePreflight -Url $credential.url -Key $credential.key
} catch {
  $preflightError = Get-SafeErrorMessage $_
  Write-BackupDiagnostic -Url $credential.url -Key $credential.key -Severity "error" -EventType "backup_preflight_failed" -Message "Backup preflight failed. No backup ZIP was created." -Details @{ error = $preflightError }
  Write-Error ("Backup preflight failed. No backup ZIP was created. " + $preflightError)
  exit 1
}

Write-Step ("Preflight passed using {0}. Found {1} database objects and {2} storage buckets." -f $credential.source, $preflight.databaseObjects.Count, @($preflight.buckets).Count)

if (-not $BackupRoot) {
  $oneDriveRoot = Join-Path $env:USERPROFILE "OneDrive - JOHN GORDON CONSTRUCTION INC"
  $BackupRoot = if (Test-Path -LiteralPath $oneDriveRoot) {
    Join-Path $oneDriveRoot "JGC Portal Backups"
  } else {
    Join-Path $PortalRoot "JGC Portal Backups"
  }
}

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupName = "jgc-portal-backup-$timestamp"
$workRoot = Join-Path $env:TEMP $backupName
$websiteRoot = Join-Path $workRoot "website-files"
$supabaseRoot = Join-Path $workRoot "supabase"
$tableRoot = Join-Path $supabaseRoot "tables"
$storageRoot = Join-Path $supabaseRoot "storage"
$schemaRoot = Join-Path $supabaseRoot "schema"
$zipPath = Join-Path $BackupRoot ($backupName + ".zip")

if (Test-Path -LiteralPath $workRoot) {
  Remove-Item -LiteralPath $workRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $websiteRoot, $tableRoot, $storageRoot, $schemaRoot -Force | Out-Null

try {
  Write-Step "Copying and verifying portal website files..."
  $websiteResult = Copy-PortalWebsite -Root $PortalRoot -Destination $websiteRoot
  Write-JsonFile -Path (Join-Path $workRoot "website-file-inventory.json") -Value $websiteResult.inventory

  $sourceInventory = Get-PortalSourceInventory -Root $PortalRoot
  $requiredTables = @(
    "profiles", "timesheet_entries", "previous_timesheet_weeks", "jobs", "work_orders",
    "work_order_labour", "work_order_purchase_orders", "work_order_equipment", "work_order_rentals",
    "work_order_materials", "work_order_misc_invoices", "work_order_travel", "work_order_labour_workers",
    "employee_feature_access",
    "inspection_records", "certificates", "certificate_expiry_notifications", "vacation_requests",
    "announcements", "announcement_acknowledgements", "toolbox_talks", "toolbox_talk_reports",
    "toolbox_talk_attendance", "daily_site_reports", "incident_reports", "accident_reports",
    "accident_report_acknowledgements", "employee_injury_reports", "employee_injury_acknowledgements",
    "policies", "equipment_vehicles", "equipment_expiry_notifications", "contacts",
    "subcontractors_suppliers", "subcontractor_supplier_contacts"
  )
  $expectedFromPortal = @($requiredTables + $sourceInventory.codeReferencedTables | Sort-Object -Unique)
  $databaseObjects = @($preflight.databaseObjects + $expectedFromPortal | Sort-Object -Unique)
  $missingFromSchema = @($expectedFromPortal | Where-Object { $_ -notin $preflight.databaseObjects })

  Write-JsonFile -Path (Join-Path $schemaRoot "openapi.json") -Value $preflight.schema
  $comparison = [ordered]@{
    discoveredFromSupabase = $preflight.databaseObjects
    referencedByPortalCode = $sourceInventory.codeReferencedTables
    referencedBySqlFiles = $sourceInventory.sqlReferencedNames
    requiredByBackupPolicy = $requiredTables
    attemptedExports = $databaseObjects
    expectedButMissingFromDataApiSchema = $missingFromSchema
  }
  Write-JsonFile -Path (Join-Path $supabaseRoot "table-inventory-comparison.json") -Value $comparison

  Write-Step "Exporting $($databaseObjects.Count) Supabase tables/views with verified pagination..."
  $tableSummary = [System.Collections.Generic.List[object]]::new()
  foreach ($table in $databaseObjects) {
    try {
      $result = Export-SupabaseTable -Url $credential.url -Key $credential.key -TableName $table -OutputDirectory $tableRoot
      $tableSummary.Add($result)
      Write-Step ("Database {0}: {1} rows ({2})" -f $table, $result.rows, $result.status)
    } catch {
      $tableSummary.Add([pscustomobject]@{
        table = $table; rows = 0; expectedRows = $null; pages = 0; bytes = 0; sha256 = "";
        file = "supabase/tables/$table.json"; status = "FAILED"; error = Get-SafeErrorMessage $_
      })
      Write-Step "Database ${table}: FAILED"
    }
  }
  Write-JsonFile -Path (Join-Path $supabaseRoot "table-export-summary.json") -Value $tableSummary.ToArray()

  Write-Step "Discovering and backing up permanent Supabase Storage buckets..."
  $bucketSummary = [System.Collections.Generic.List[object]]::new()
  $storageInventory = [System.Collections.Generic.List[object]]::new()
  $allLiveBucketNames = @($preflight.buckets | ForEach-Object { if ($_.id) { [string]$_.id } else { [string]$_.name } } | Where-Object { $_ } | Sort-Object -Unique)
  $excludedLiveBucketNames = @($allLiveBucketNames | Where-Object { $_ -in $script:EphemeralStorageBuckets })
  $liveBucketNames = @($allLiveBucketNames | Where-Object { $_ -notin $script:EphemeralStorageBuckets })

  foreach ($excludedBucket in $excludedLiveBucketNames) {
    Write-Step "Storage ${excludedBucket}: EXCLUDED (temporary delivery files)"
  }

  foreach ($bucket in $liveBucketNames) {
    try {
      $bucketResult = Backup-SupabaseStorageBucket -Url $credential.url -Key $credential.key -BucketName $bucket -OutputDirectory $storageRoot
      $bucketSummary.Add($bucketResult.summary)
      foreach ($item in @($bucketResult.inventory)) { $storageInventory.Add($item) }
      Write-Step ("Storage {0}: {1} files ({2})" -f $bucket, $bucketResult.summary.files, $bucketResult.summary.status)
    } catch {
      $bucketSummary.Add([pscustomobject]@{
        bucket = $bucket; filesDiscovered = 0; files = 0; bytes = 0; failedFiles = 0;
        status = "FAILED"; error = Get-SafeErrorMessage $_; failures = @()
      })
      Write-Step "Storage ${bucket}: FAILED"
    }
  }

  foreach ($missingBucket in @($sourceInventory.codeReferencedBuckets | Where-Object { $_ -notin $allLiveBucketNames })) {
    $bucketSummary.Add([pscustomobject]@{
      bucket = $missingBucket; filesDiscovered = 0; files = 0; bytes = 0; failedFiles = 0;
      status = "FAILED"; error = "Bucket is referenced by portal code but is missing from live Supabase Storage."; failures = @()
    })
  }

  Write-JsonFile -Path (Join-Path $supabaseRoot "storage-export-summary.json") -Value $bucketSummary.ToArray()
  Write-JsonFile -Path (Join-Path $supabaseRoot "storage-file-inventory.json") -Value $storageInventory.ToArray()

  $tableFailures = @($tableSummary | Where-Object status -eq "FAILED")
  $tableEmpty = @($tableSummary | Where-Object status -eq "EMPTY")
  $tableSucceeded = @($tableSummary | Where-Object { $_.status -in @("EXPORTED", "EMPTY") })
  $totalRows = [int64]0
  $databaseBytes = [int64]0
  foreach ($table in $tableSucceeded) {
    $totalRows += [int64]$table.rows
    $databaseBytes += [int64]$table.bytes
  }
  $databaseStatus = if ($tableFailures.Count -gt 0 -or $tableSucceeded.Count -ne $databaseObjects.Count -or $totalRows -eq 0) { "FAILED" } else { "PASSED" }

  $storageFailures = @($bucketSummary | Where-Object status -eq "FAILED")
  $storageFiles = [int64]0
  $storageBytes = [int64]0
  foreach ($bucket in $bucketSummary) {
    $storageFiles += [int64]$bucket.files
    $storageBytes += [int64]$bucket.bytes
  }
  $storageStatus = if ($storageFailures.Count -gt 0) { "FAILED" } else { "PASSED" }

  $failedItems = [System.Collections.Generic.List[object]]::new()
  foreach ($failure in $websiteResult.failures) {
    $failedItems.Add([pscustomobject]@{ area = "website"; item = $failure.file; error = $failure.error })
  }
  foreach ($failure in $tableFailures) {
    $failedItems.Add([pscustomobject]@{ area = "database"; item = $failure.table; error = $failure.error })
  }
  if ($totalRows -eq 0) {
    $failedItems.Add([pscustomobject]@{ area = "database"; item = "all exports"; error = "All database exports contain zero rows; backup is suspicious and cannot pass." })
  }
  foreach ($failure in $storageFailures) {
    $failedItems.Add([pscustomobject]@{ area = "storage"; item = $failure.bucket; error = $failure.error })
  }

  $overallStatus = if ($databaseStatus -eq "FAILED" -or $websiteResult.status -eq "FAILED" -or $storageStatus -eq "FAILED") { "FAILED" } else { "PASSED" }
  $restoreStatus = if ($overallStatus -eq "PASSED") { "READY_WITH_MANUAL_SCHEMA_AND_IMPORT_STEPS" } else { "NOT_READY" }
  $restoreReadiness = [ordered]@{
    status = $restoreStatus
    databaseObjectsIncluded = @($tableSucceeded | ForEach-Object table)
    databaseRowsIncluded = $totalRows
    databaseFormat = "One verified JSON array per table/view"
    schemaInformationIncluded = @("supabase/schema/openapi.json", "website-files/*.sql", "website-files/supabase/**")
    storageBucketsIncluded = @($bucketSummary | Where-Object { $_.status -in @("COPIED", "EMPTY") } | ForEach-Object bucket)
    storageBucketsExcluded = $excludedLiveBucketNames
    storageFilesIncluded = @($storageInventory | ForEach-Object { "$($_.bucket)/$($_.path)" })
    websiteFilesIncluded = $websiteResult.files
    credentialsIncluded = $false
    manualSteps = @(
      "Create or recover the target Supabase project and review the included SQL/setup files before importing data.",
      "Recreate tables, constraints, triggers, functions, RLS policies, and views before loading table JSON files.",
      "Import parent tables before dependent work-order, acknowledgement, and notification tables.",
      "Recreate each Storage bucket with the correct public/private setting, then upload files using the preserved bucket/path structure.",
      "Create new Supabase publishable and secret keys and configure them outside the restored website source.",
      "Perform a controlled test restore in a non-production project before restoring production."
    )
    limitations = @(
      "This backup does not automatically overwrite a database.",
      "OpenAPI records columns and API shapes but is not a complete pg_dump of database grants, triggers, or function bodies. Use the included SQL files and Supabase project tooling during schema restoration."
    )
  }
  Write-JsonFile -Path (Join-Path $workRoot "restore-readiness.json") -Value $restoreReadiness

  $payloadBytes = [int64]((Get-ChildItem -LiteralPath $workRoot -Recurse -File | Measure-Object -Property Length -Sum).Sum)
  $manifest = [ordered]@{
    formatVersion = 2
    createdAt = (Get-Date).ToString("o")
    backupLocation = $zipPath
    portalSourceLocation = $PortalRoot
    overallStatus = $overallStatus
    websiteStatus = $websiteResult.status
    databaseStatus = $databaseStatus
    storageStatus = $storageStatus
    supabaseExportConfigured = $true
    tablesAttempted = $databaseObjects.Count
    tablesSuccessfullyExported = $tableSucceeded.Count
    tablesEmpty = $tableEmpty.Count
    tablesFailed = $tableFailures.Count
    totalDatabaseRowsExported = $totalRows
    databaseExportBytes = $databaseBytes
    storageBucketsChecked = $bucketSummary.Count
    storageBucketsExcluded = $excludedLiveBucketNames
    storageFilesCopied = $storageFiles
    totalStorageBytes = $storageBytes
    websiteFilesCopied = $websiteResult.files
    totalWebsiteBytes = $websiteResult.bytes
    totalBackupBytes = $payloadBytes
    restoreReadiness = $restoreStatus
    failedItems = $failedItems.ToArray()
    retention = [ordered]@{ days = $RetentionDays; pattern = "jgc-portal-backup-*.zip" }
    credentialStorage = $credential.source
    credentialsIncludedInBackup = $false
  }
  Write-JsonFile -Path (Join-Path $workRoot "backup-manifest.json") -Value $manifest

  $summaryLines = @(
    "JGC Portal Disaster-Recovery Backup",
    "Status: $overallStatus",
    "Created: $($manifest.createdAt)",
    "Portal source: $PortalRoot",
    "Backup archive: $zipPath",
    "",
    "Website: $($websiteResult.status) - $($websiteResult.files) files - $($websiteResult.bytes) bytes",
    "Database: $databaseStatus - $($databaseObjects.Count) attempted - $($tableSucceeded.Count) exported - $($tableFailures.Count) failed - $totalRows rows",
    "Storage: $storageStatus - $($bucketSummary.Count) permanent buckets - $storageFiles files - $storageBytes bytes",
    "Temporary Storage excluded: $($excludedLiveBucketNames -join ', ')",
    "Restore readiness: $restoreStatus",
    "Retention: $RetentionDays days",
    "Credentials included: No",
    "",
    "Failed items:"
  )
  if ($failedItems.Count -eq 0) {
    $summaryLines += "None"
  } else {
    foreach ($failure in $failedItems) {
      $summaryLines += "- $($failure.area) / $($failure.item): $($failure.error)"
    }
  }
  Write-Utf8Text -Path (Join-Path $workRoot "backup-summary.txt") -Value ($summaryLines -join [Environment]::NewLine)

  Write-Step "Creating ZIP backup..."
  Compress-Archive -Path (Join-Path $workRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force
  $validation = Test-BackupArchive -ZipPath $zipPath
  Write-JsonFile -Path (Join-Path $workRoot "post-backup-validation.json") -Value $validation
  Compress-Archive -Path (Join-Path $workRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force
  $validation = Test-BackupArchive -ZipPath $zipPath
  Write-JsonFile -Path (Join-Path $workRoot "post-backup-validation.json") -Value $validation
  Compress-Archive -Path (Join-Path $workRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force
  $validation = Test-BackupArchive -ZipPath $zipPath

  if ($RetentionDays -gt 0) {
    Write-Step "Removing backups older than $RetentionDays days..."
    Get-ChildItem -LiteralPath $BackupRoot -Filter "jgc-portal-backup-*.zip" -File |
      Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
      Remove-Item -Force
  }

  if ($overallStatus -ne "PASSED" -or $validation.status -ne "PASS") {
    Write-BackupDiagnostic -Url $credential.url -Key $credential.key -Severity "error" -EventType "backup_failed" -Message "Backup was created but failed validation." -Details @{
      archive = $zipPath
      overallStatus = $overallStatus
      validationStatus = $validation.status
      databaseStatus = $databaseStatus
      storageStatus = $storageStatus
      websiteStatus = $websiteResult.status
      failedItems = $failedItems.ToArray()
    }
    Write-Error "Backup created but FAILED validation: $zipPath"
    exit 1
  }

  Write-BackupDiagnostic -Url $credential.url -Key $credential.key -Severity "info" -EventType "backup_completed" -Message "Portal backup completed and passed validation." -Details @{
    archive = $zipPath
    databaseRows = $totalRows
    storageFiles = $storageFiles
    websiteFiles = $websiteResult.files
    validationStatus = $validation.status
  }
  Write-Step "Backup validation PASS."
  Write-Step "Backup complete: $zipPath"
  Write-Output $zipPath
} catch {
  $unhandledBackupFailure = $true
  $fatalError = Get-SafeErrorMessage $_
  $failureLogPath = Join-Path $BackupRoot ($backupName + "-FAILED.txt")
  $failureLog = @(
    "JGC Portal Backup Failed",
    "Time: $((Get-Date).ToString('o'))",
    "Portal source: $PortalRoot",
    "Error: $fatalError"
  ) -join [Environment]::NewLine

  try {
    Write-Utf8Text -Path $failureLogPath -Value $failureLog
  } catch {
    Write-Step ("Local failure log could not be written: " + (Get-SafeErrorMessage $_))
  }

  Write-BackupDiagnostic -Url $credential.url -Key $credential.key -Severity "error" -EventType "backup_failed" -Message "Backup stopped before a validated ZIP could be created." -Details @{
    error = $fatalError
    failureLog = $failureLogPath
  }
  Write-Error ("Backup stopped before a validated ZIP could be created. " + $fatalError)
} finally {
  $script:RedactionKey = ""
  if (Test-Path -LiteralPath $workRoot) {
    Write-Step "Cleaning temporary backup files..."
    Remove-Item -LiteralPath $workRoot -Recurse -Force
  }
}

if ($unhandledBackupFailure) {
  exit 1
}
