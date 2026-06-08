param(
  [string]$PortalRoot = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [string]$BackupRoot = "",
  [int]$RetentionDays = 90
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step($Message) {
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message)
}

function Get-EncodedStoragePath($Path) {
  return (($Path -split "/") | ForEach-Object { [uri]::EscapeDataString($_) }) -join "/"
}

function Get-SupabaseHeaders($Key, [switch]$Json) {
  $headers = @{
    "apikey" = $Key
  }

  if ($Key -match "\.") {
    $headers["Authorization"] = "Bearer $Key"
  }

  if ($Json) {
    $headers["Content-Type"] = "application/json"
  }

  return $headers
}

function Invoke-SupabaseJsonRequest($Uri, $Key, $Method, $Body) {
  $headers = Get-SupabaseHeaders -Key $Key

  if ($Body) {
    $headers = Get-SupabaseHeaders -Key $Key -Json
    return Invoke-RestMethod -Uri $Uri -Method $Method -Headers $headers -Body ($Body | ConvertTo-Json -Depth 20)
  }

  return Invoke-RestMethod -Uri $Uri -Method $Method -Headers $headers
}

function Export-SupabaseTable($Url, $Key, $TableName, $OutputDirectory) {
  $pageSize = 1000
  $offset = 0
  $allRows = @()

  do {
    $headers = Get-SupabaseHeaders -Key $Key
    $uri = "$Url/rest/v1/$([uri]::EscapeDataString($TableName))?select=*&limit=$pageSize&offset=$offset"
    $result = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers
    $batch = @()
    if ($null -ne $result) {
      $batch = @($result)
    }
    $allRows += $batch
    $offset += $pageSize
  } while (@($batch).Count -eq $pageSize)

  $outputPath = Join-Path $OutputDirectory ($TableName + ".json")
  if (@($allRows).Count -eq 0) {
    "[]" | Set-Content -LiteralPath $outputPath -Encoding UTF8
  } else {
    @($allRows) | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $outputPath -Encoding UTF8
  }
  return @($allRows).Count
}

function Get-SupabaseStorageObjects($Url, $Key, $BucketName, $Prefix = "") {
  $objects = @()
  $offset = 0
  $limit = 1000

  do {
    $body = @{
      prefix = $Prefix
      limit = $limit
      offset = $offset
      sortBy = @{
        column = "name"
        order = "asc"
      }
    }
    $uri = "$Url/storage/v1/object/list/$([uri]::EscapeDataString($BucketName))"
    $result = Invoke-SupabaseJsonRequest -Uri $uri -Key $Key -Method "POST" -Body $body
    $batch = if ($null -eq $result) { @() } elseif ($result -is [array]) { $result } else { @($result) }
    $batchItems = @($batch)

    foreach ($item in $batchItems) {
      if ($null -eq $item) {
        continue
      }

      $name = if ($Prefix) { "$Prefix/$($item.name)" } else { $item.name }
      $isFile = ($item.PSObject.Properties.Name -contains "id" -and $item.id) -or
        ($item.PSObject.Properties.Name -contains "metadata" -and $item.metadata)

      if ($isFile) {
        $objects += $name
      } else {
        $objects += Get-SupabaseStorageObjects -Url $Url -Key $Key -BucketName $BucketName -Prefix $name
      }
    }

    $offset += $limit
  } while ($batchItems.Count -eq $limit)

  return $objects
}

function Backup-SupabaseStorageBucket($Url, $Key, $BucketName, $OutputDirectory) {
  $bucketDirectory = Join-Path $OutputDirectory $BucketName
  New-Item -ItemType Directory -Path $bucketDirectory -Force | Out-Null

  $objects = Get-SupabaseStorageObjects -Url $Url -Key $Key -BucketName $BucketName
  $downloaded = 0

  foreach ($objectPath in $objects) {
    $relativePath = $objectPath -replace "/", [System.IO.Path]::DirectorySeparatorChar
    $targetPath = Join-Path $bucketDirectory $relativePath
    New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null

    $encodedPath = Get-EncodedStoragePath $objectPath
    $uri = "$Url/storage/v1/object/$([uri]::EscapeDataString($BucketName))/$encodedPath"
    $headers = Get-SupabaseHeaders -Key $Key

    Invoke-WebRequest -Uri $uri -Method Get -Headers $headers -OutFile $targetPath | Out-Null
    $downloaded++
  }

  return $downloaded
}

$PortalRoot = (Resolve-Path -LiteralPath $PortalRoot).Path

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
$zipPath = Join-Path $BackupRoot ($backupName + ".zip")

if (Test-Path -LiteralPath $workRoot) {
  Remove-Item -LiteralPath $workRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $websiteRoot -Force | Out-Null
New-Item -ItemType Directory -Path $supabaseRoot -Force | Out-Null

Write-Step "Copying portal website files..."

$excludedDirectories = @(".git", ".agents", ".codex", "node_modules", "JGC Portal Backups")
$excludedFiles = @("backup-secrets.json")
$copiedFiles = 0

Get-ChildItem -LiteralPath $PortalRoot -Recurse -File | ForEach-Object {
  $relative = $_.FullName.Substring($PortalRoot.Length).TrimStart("\", "/")
  $parts = $relative -split "[\\/]"

  $excludedPartMatches = @($parts | Where-Object { $excludedDirectories -contains $_ })
  if ($excludedPartMatches.Count -gt 0) {
    return
  }

  if ($excludedFiles -contains $_.Name) {
    return
  }

  $targetPath = Join-Path $websiteRoot $relative
  New-Item -ItemType Directory -Path (Split-Path -Parent $targetPath) -Force | Out-Null
  Copy-Item -LiteralPath $_.FullName -Destination $targetPath -Force
  $copiedFiles++
}

$defaultTables = @(
  "profiles",
  "timesheet_entries",
  "previous_timesheet_weeks",
  "jobs",
  "work_orders",
  "work_order_labour",
  "work_order_purchase_orders",
  "work_order_equipment",
  "work_order_rentals",
  "work_order_materials",
  "work_order_misc_invoices",
  "work_order_travel",
  "work_order_labour_workers",
  "inspection_records",
  "certificates",
  "certificate_expiry_notifications",
  "vacation_requests",
  "announcements",
  "announcement_acknowledgements",
  "toolbox_talks",
  "toolbox_talk_reports",
  "toolbox_talk_attendance",
  "daily_site_reports",
  "incident_reports",
  "accident_reports",
  "accident_report_acknowledgements",
  "employee_injury_reports",
  "employee_injury_acknowledgements",
  "policies",
  "equipment_vehicles",
  "equipment_expiry_notifications",
  "contacts"
)

$defaultBuckets = @(
  "certificates",
  "profile-photos",
  "incident-photos",
  "announcements",
  "policies",
  "toolbox-talks",
  "inspections"
)

$secretsPath = Join-Path $PortalRoot "backup-secrets.json"
$supabaseConfigured = $false

if (Test-Path -LiteralPath $secretsPath) {
  Write-Step "Exporting Supabase tables and storage..."
  $config = Get-Content -LiteralPath $secretsPath -Raw | ConvertFrom-Json
  $supabaseUrl = [string]$config.supabaseUrl
  $supabaseKey = [string]$config.supabaseServiceRoleKey
  $tables = if ($config.tables) { @($config.tables) } else { $defaultTables }
  $buckets = if ($config.storageBuckets) { @($config.storageBuckets) } else { $defaultBuckets }

  if ($supabaseUrl -and $supabaseKey) {
    $supabaseConfigured = $true
    $tableRoot = Join-Path $supabaseRoot "tables"
    $storageRoot = Join-Path $supabaseRoot "storage"
    New-Item -ItemType Directory -Path $tableRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $storageRoot -Force | Out-Null

    $tableSummary = @()
    foreach ($table in $tables) {
      try {
        $count = Export-SupabaseTable -Url $supabaseUrl.TrimEnd("/") -Key $supabaseKey -TableName $table -OutputDirectory $tableRoot
        $tableSummary += [pscustomobject]@{ table = $table; rows = $count; status = "ok" }
      } catch {
        $tableSummary += [pscustomobject]@{ table = $table; rows = 0; status = $_.Exception.Message }
      }
    }

    $bucketSummary = @()
    foreach ($bucket in $buckets) {
      try {
        $count = Backup-SupabaseStorageBucket -Url $supabaseUrl.TrimEnd("/") -Key $supabaseKey -BucketName $bucket -OutputDirectory $storageRoot
        $bucketSummary += [pscustomobject]@{ bucket = $bucket; files = $count; status = "ok" }
      } catch {
        $bucketSummary += [pscustomobject]@{ bucket = $bucket; files = 0; status = $_.Exception.Message }
      }
    }

    $tableSummary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $supabaseRoot "table-export-summary.json") -Encoding UTF8
    $bucketSummary | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $supabaseRoot "storage-export-summary.json") -Encoding UTF8
  }
}

if (-not $supabaseConfigured) {
  "Supabase export skipped. Add backup-secrets.json beside backup-jgc-portal.ps1 to include database tables and storage files." |
    Set-Content -LiteralPath (Join-Path $supabaseRoot "SUPABASE_EXPORT_SKIPPED.txt") -Encoding UTF8
}

$manifest = [pscustomobject]@{
  createdAt = (Get-Date).ToString("o")
  portalRoot = $PortalRoot
  backupRoot = $BackupRoot
  websiteFilesCopied = $copiedFiles
  supabaseExportConfigured = $supabaseConfigured
  retentionDays = $RetentionDays
}

$manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $workRoot "backup-manifest.json") -Encoding UTF8

Write-Step "Creating ZIP backup..."
Compress-Archive -Path (Join-Path $workRoot "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force

Write-Step "Cleaning temporary backup files..."
Remove-Item -LiteralPath $workRoot -Recurse -Force

if ($RetentionDays -gt 0) {
  Write-Step "Removing backups older than $RetentionDays days..."
  Get-ChildItem -LiteralPath $BackupRoot -Filter "jgc-portal-backup-*.zip" -File |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$RetentionDays) } |
    Remove-Item -Force
}

Write-Step "Backup complete: $zipPath"
return $zipPath
