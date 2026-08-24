param(
    [string]$PortalRoot = $PSScriptRoot,
    [string]$MirrorRoot = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:FailureCount = 0
$script:WarningCount = 0
$script:PassCount = 0

function Write-ReleaseResult {
    param(
        [ValidateSet("PASS", "WARN", "FAIL")]
        [string]$Status,
        [string]$Message
    )

    $color = switch ($Status) {
        "PASS" { "Green" }
        "WARN" { "Yellow" }
        "FAIL" { "Red" }
    }

    switch ($Status) {
        "PASS" { $script:PassCount++ }
        "WARN" { $script:WarningCount++ }
        "FAIL" { $script:FailureCount++ }
    }

    Write-Host ("[{0}] {1}" -f $Status, $Message) -ForegroundColor $color
}

function Resolve-NodeExecutable {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
        "C:\Program Files\nodejs\node.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return $candidate
        }
    }

    return $null
}

function Get-LocalAssetPath {
    param([string]$Reference)

    $value = [System.Net.WebUtility]::HtmlDecode([string]$Reference).Trim()
    if (
        [string]::IsNullOrWhiteSpace($value) -or
        $value.StartsWith("#") -or
        $value.StartsWith("?") -or
        $value -match "^(?i)(?:https?:|data:|blob:|mailto:|tel:|javascript:|//)" -or
        $value.Contains('${')
    ) {
        return $null
    }

    $path = ($value -split "[?#]", 2)[0]
    if ([string]::IsNullOrWhiteSpace($path)) {
        return $null
    }

    $path = [System.Uri]::UnescapeDataString($path).Replace("/", "\")
    while ($path.StartsWith(".\")) {
        $path = $path.Substring(2)
    }

    return $path
}

function Get-ComparableFileHash {
    param(
        [string]$Path,
        [string]$RelativePath
    )

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $extension = [System.IO.Path]::GetExtension($RelativePath).ToLowerInvariant()
    $textExtensions = @(
        ".bat", ".cmd", ".css", ".csv", ".html", ".js", ".json", ".jsx",
        ".md", ".mjs", ".ps1", ".sql", ".svg", ".toml", ".ts", ".tsx",
        ".txt", ".webmanifest", ".xml", ".yaml", ".yml"
    )
    $normalizedRelativePath = $RelativePath.Replace("/", "\")
    $isGeneratedBinary =
        $normalizedRelativePath -like "estimating\assets\*.js" -or
        $normalizedRelativePath -like "estimating\supplier-import\*" -or
        $normalizedRelativePath -like "estimating-app\public\supplier-import\*"

    if (($textExtensions -contains $extension) -and -not $isGeneratedBinary) {
        $normalizedBytes = [byte[]]::new($bytes.Length)
        $writeIndex = 0

        for ($readIndex = 0; $readIndex -lt $bytes.Length; $readIndex++) {
            if ($bytes[$readIndex] -eq 13) {
                if (($readIndex + 1) -lt $bytes.Length -and $bytes[$readIndex + 1] -eq 10) {
                    $readIndex++
                }
                $normalizedBytes[$writeIndex] = 10
            } else {
                $normalizedBytes[$writeIndex] = $bytes[$readIndex]
            }
            $writeIndex++
        }

        if ($writeIndex -ne $normalizedBytes.Length) {
            [Array]::Resize([ref]$normalizedBytes, $writeIndex)
        }
        $bytes = $normalizedBytes
    }

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace("-", "")
    } finally {
        $sha256.Dispose()
    }
}

$PortalRoot = (Resolve-Path -LiteralPath $PortalRoot).Path
$requestedRootName = Split-Path -Leaf $PortalRoot
$requestedRootParent = Split-Path -Parent $PortalRoot
$requestedParentName = Split-Path -Leaf $requestedRootParent

if ($requestedRootName -ieq "jgctimesheet" -and $requestedParentName -ieq "GitHub") {
    if (-not $MirrorRoot) {
        $MirrorRoot = $PortalRoot
    }

    $sourceCandidate = Join-Path (Split-Path -Parent $requestedRootParent) "index.html"
    if (Test-Path -LiteralPath (Join-Path $sourceCandidate "service-worker.js") -PathType Leaf) {
        $PortalRoot = (Resolve-Path -LiteralPath $sourceCandidate).Path
    }
}

if (-not $MirrorRoot) {
    $documentsRoot = Split-Path -Parent $PortalRoot
    $MirrorRoot = Join-Path $documentsRoot "GitHub\jgctimesheet"
}

Write-Host "JGC Portal release verification" -ForegroundColor Cyan
Write-Host ("Source: {0}" -f $PortalRoot)
Write-Host ("Mirror: {0}" -f $MirrorRoot)
Write-Host ""

$serviceWorkerPath = Join-Path $PortalRoot "service-worker.js"
$commonPath = Join-Path $PortalRoot "common.js"
$serviceWorker = Get-Content -LiteralPath $serviceWorkerPath -Raw
$commonScript = Get-Content -LiteralPath $commonPath -Raw

$releaseMatch = [regex]::Match($serviceWorker, 'const\s+JGC_RELEASE_ID\s*=\s*"(\d+)"')
if ($releaseMatch.Success) {
    Write-ReleaseResult "PASS" ("Release ID is {0}." -f $releaseMatch.Groups[1].Value)
} else {
    Write-ReleaseResult "FAIL" "service-worker.js does not define a numeric JGC_RELEASE_ID."
}

$shellMatch = [regex]::Match($serviceWorker, '(?s)const\s+JGC_APP_SHELL\s*=\s*\[(.*?)\];')
$shellReferences = @()
if ($shellMatch.Success) {
    $shellReferences = @([regex]::Matches($shellMatch.Groups[1].Value, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value })
    Write-ReleaseResult "PASS" ("Service worker app shell contains {0} entries." -f $shellReferences.Count)
} else {
    Write-ReleaseResult "FAIL" "The JGC_APP_SHELL list could not be read."
}

$normalizedShellGroups = $shellReferences | Group-Object {
    $value = $_.TrimStart('.', '/')
    if ($value -match '^(.*?)\?v=\d+(?:&.*)?$') {
        return $Matches[1]
    }
    return $value
}
$duplicateShellAssets = @($normalizedShellGroups | Where-Object { $_.Count -gt 1 })
if ($duplicateShellAssets.Count -eq 0) {
    Write-ReleaseResult "PASS" "The app shell has no duplicate file entries."
} else {
    foreach ($duplicate in $duplicateShellAssets) {
        Write-ReleaseResult "FAIL" ("App shell file is listed more than once: {0}" -f $duplicate.Name)
    }
}

$missingShellAssets = @()
foreach ($reference in $shellReferences) {
    $assetPath = Get-LocalAssetPath $reference
    if ($assetPath -and -not (Test-Path -LiteralPath (Join-Path $PortalRoot $assetPath))) {
        $missingShellAssets += $reference
    }
}

if ($missingShellAssets.Count -eq 0) {
    Write-ReleaseResult "PASS" "Every app-shell entry exists locally."
} else {
    foreach ($missing in $missingShellAssets) {
        Write-ReleaseResult "FAIL" ("Missing app-shell file: {0}" -f $missing)
    }
}

$localShellFiles = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$appShellBytes = [long]0
foreach ($reference in $shellReferences) {
    $assetPath = Get-LocalAssetPath $reference
    if (-not $assetPath -or $assetPath.EndsWith("\") -or -not $localShellFiles.Add($assetPath)) {
        continue
    }

    $fullAssetPath = Join-Path $PortalRoot $assetPath
    if (Test-Path -LiteralPath $fullAssetPath -PathType Leaf) {
        $appShellBytes += (Get-Item -LiteralPath $fullAssetPath).Length
    }
}

$appShellMegabytes = $appShellBytes / 1MB
Write-ReleaseResult "PASS" ("Offline app-shell payload is {0:N2} MB across {1} local files." -f $appShellMegabytes, $localShellFiles.Count)

$assetReferenceText = [System.Text.StringBuilder]::new()
$assetReferenceExtensions = @(".html", ".js", ".css", ".json")
foreach ($referenceFile in Get-ChildItem -LiteralPath $PortalRoot -File) {
    if ($assetReferenceExtensions -notcontains $referenceFile.Extension.ToLowerInvariant()) {
        continue
    }

    $null = $assetReferenceText.AppendLine([System.IO.File]::ReadAllText($referenceFile.FullName))
}

$bundledAssetCandidates = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
foreach ($imageFile in Get-ChildItem -LiteralPath $PortalRoot -File | Where-Object { $_.Extension -match '^(?i)\.(?:png|webp|jpg|jpeg|gif|svg)$' }) {
    $bundledAssetCandidates.Add($imageFile)
}

$vendorRoot = Join-Path $PortalRoot "vendor"
if (Test-Path -LiteralPath $vendorRoot -PathType Container) {
    foreach ($vendorFile in Get-ChildItem -LiteralPath $vendorRoot -File) {
        $bundledAssetCandidates.Add($vendorFile)
    }
}

$unusedBundledAssets = @($bundledAssetCandidates | Where-Object {
    $assetReferenceText.ToString().IndexOf($_.Name, [System.StringComparison]::OrdinalIgnoreCase) -lt 0
})

if ($unusedBundledAssets.Count -eq 0) {
    Write-ReleaseResult "PASS" "Every bundled image and vendor library is referenced by the portal."
} else {
    foreach ($unusedAsset in $unusedBundledAssets) {
        Write-ReleaseResult "FAIL" ("Unreferenced bundled asset: {0}" -f $unusedAsset.FullName.Substring($PortalRoot.Length + 1))
    }
}

$shellHtmlNames = @($shellReferences | ForEach-Object { (($_ -split '[?#]', 2)[0]).TrimStart('.', '/') } | Where-Object { $_ -like "*.html" } | Sort-Object -Unique)
$uncachedPages = @(Get-ChildItem -LiteralPath $PortalRoot -File -Filter "*.html" | Where-Object { $shellHtmlNames -notcontains $_.Name })
if ($uncachedPages.Count -eq 0) {
    Write-ReleaseResult "PASS" "Every portal HTML page is represented in the offline app shell."
} else {
    foreach ($page in $uncachedPages) {
        Write-ReleaseResult "FAIL" ("HTML page is missing from the app shell: {0}" -f $page.Name)
    }
}

$brokenReferences = [System.Collections.Generic.List[string]]::new()
$versionRows = [System.Collections.Generic.List[object]]::new()
$attributePattern = '(?i)(?:src|href)\s*=\s*["'']([^"'']+)["'']'

foreach ($htmlFile in Get-ChildItem -LiteralPath $PortalRoot -File -Filter "*.html") {
    $html = Get-Content -LiteralPath $htmlFile.FullName -Raw
    foreach ($match in [regex]::Matches($html, $attributePattern)) {
        $reference = $match.Groups[1].Value
        $assetPath = Get-LocalAssetPath $reference

        if ($assetPath -and -not (Test-Path -LiteralPath (Join-Path $PortalRoot $assetPath))) {
            $brokenReferences.Add(("{0}: {1}" -f $htmlFile.Name, $reference))
        }

        $versionMatch = [regex]::Match($reference, '^(?!https?:|//)(.+?)\?v=(\d+)(?:[&#].*)?$', 'IgnoreCase')
        if ($versionMatch.Success) {
            $versionRows.Add([pscustomobject]@{
                Asset = $versionMatch.Groups[1].Value.TrimStart(".", "/")
                Version = $versionMatch.Groups[2].Value
                Page = $htmlFile.Name
            })
        }
    }
}

if ($brokenReferences.Count -eq 0) {
    Write-ReleaseResult "PASS" "All local HTML asset references resolve to existing files."
} else {
    foreach ($broken in $brokenReferences) {
        Write-ReleaseResult "FAIL" ("Broken local HTML reference: {0}" -f $broken)
    }
}

$inconsistentVersions = @($versionRows | Group-Object Asset | Where-Object {
    @($_.Group.Version | Sort-Object -Unique).Count -gt 1
})

if ($inconsistentVersions.Count -eq 0) {
    Write-ReleaseResult "PASS" "Versioned HTML asset references are consistent."
} else {
    foreach ($group in $inconsistentVersions) {
        $versions = @($group.Group.Version | Sort-Object -Unique) -join ", "
        $pages = @($group.Group.Page | Sort-Object -Unique) -join ", "
        Write-ReleaseResult "FAIL" ("Mixed versions for {0}: {1} ({2})" -f $group.Name, $versions, $pages)
    }
}

$commonDesignVersion = [regex]::Match($commonScript, 'JGC_DESIGN_SYSTEM_VERSION\s*=\s*"(\d+)"')
$cachedDesignVersion = [regex]::Match($serviceWorker, 'jgc-design-system\.css\?v=(\d+)')
if (
    $commonDesignVersion.Success -and
    $cachedDesignVersion.Success -and
    $commonDesignVersion.Groups[1].Value -eq $cachedDesignVersion.Groups[1].Value
) {
    Write-ReleaseResult "PASS" ("Design-system version matches at v{0}." -f $commonDesignVersion.Groups[1].Value)
} else {
    Write-ReleaseResult "FAIL" "common.js and service-worker.js use different design-system versions."
}

$node = Resolve-NodeExecutable
if (-not $node) {
    Write-ReleaseResult "FAIL" "Node.js was not found, so JavaScript syntax could not be verified."
} else {
    $scriptFailures = [System.Collections.Generic.List[string]]::new()
    $rootScripts = @(Get-ChildItem -LiteralPath $PortalRoot -File -Filter "*.js")

    foreach ($scriptFile in $rootScripts) {
        $null = & $node --check $scriptFile.FullName 2>&1
        if ($LASTEXITCODE -ne 0) {
            $scriptFailures.Add($scriptFile.Name)
        }
    }

    $tempRoot = Join-Path $env:TEMP ("jgc-release-check-" + [guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    $inlineCount = 0

    try {
        foreach ($htmlFile in Get-ChildItem -LiteralPath $PortalRoot -File -Filter "*.html") {
            $html = Get-Content -LiteralPath $htmlFile.FullName -Raw
            $inlineIndex = 0

            foreach ($match in [regex]::Matches($html, '(?is)<script\b(?![^>]*\bsrc\s*=)([^>]*)>(.*?)</script>')) {
                $attributes = $match.Groups[1].Value
                $content = $match.Groups[2].Value

                if (
                    $attributes -match '(?i)type\s*=\s*["''](?:application/(?:ld\+json|json)|text/template)' -or
                    [string]::IsNullOrWhiteSpace($content)
                ) {
                    continue
                }

                $inlineIndex++
                $inlineCount++
                $tempFile = Join-Path $tempRoot ("{0}-inline-{1}.js" -f $htmlFile.BaseName, $inlineIndex)
                [System.IO.File]::WriteAllText($tempFile, $content, [System.Text.UTF8Encoding]::new($false))
                $null = & $node --check $tempFile 2>&1

                if ($LASTEXITCODE -ne 0) {
                    $scriptFailures.Add(("{0} inline script {1}" -f $htmlFile.Name, $inlineIndex))
                }
            }
        }
    } finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }

    if ($scriptFailures.Count -eq 0) {
        Write-ReleaseResult "PASS" ("JavaScript syntax passed for {0} files and {1} inline scripts." -f $rootScripts.Count, $inlineCount)
    } else {
        foreach ($failure in $scriptFailures) {
            Write-ReleaseResult "FAIL" ("JavaScript syntax failed: {0}" -f $failure)
        }
    }
}

if (-not (Test-Path -LiteralPath $MirrorRoot -PathType Container)) {
    Write-ReleaseResult "FAIL" ("GitHub mirror folder was not found: {0}" -f $MirrorRoot)
} else {
    $releaseFiles = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($page in Get-ChildItem -LiteralPath $PortalRoot -File -Filter "*.html") {
        $null = $releaseFiles.Add($page.Name)
    }
    foreach ($reference in $shellReferences) {
        $assetPath = Get-LocalAssetPath $reference
        if ($assetPath -and -not $assetPath.EndsWith("\")) {
            $null = $releaseFiles.Add($assetPath)
        }
    }
    foreach ($fileName in @(
        "service-worker.js",
        "verify-jgc-release.ps1",
        "run-jgc-release-check.bat",
        "run-jgc-smoke-tests.ps1",
        "run-jgc-smoke-tests.bat",
        "playwright.config.js",
        "package.json",
        "package-lock.json",
        "pnpm-lock.yaml",
        "smoke-tests\static-server.js",
        "smoke-tests\portal.smoke.spec.js",
        "JGC-RELEASE.md"
    )) {
        $null = $releaseFiles.Add($fileName)
    }

    $mirrorProblems = [System.Collections.Generic.List[string]]::new()
    foreach ($relativePath in $releaseFiles) {
        $sourcePath = Join-Path $PortalRoot $relativePath
        $mirrorPath = Join-Path $MirrorRoot $relativePath

        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            continue
        }
        if (-not (Test-Path -LiteralPath $mirrorPath -PathType Leaf)) {
            $mirrorProblems.Add(("Missing from mirror: {0}" -f $relativePath))
            continue
        }

        $sourceHash = Get-ComparableFileHash -Path $sourcePath -RelativePath $relativePath
        $mirrorHash = Get-ComparableFileHash -Path $mirrorPath -RelativePath $relativePath
        if ($sourceHash -ne $mirrorHash) {
            $mirrorProblems.Add(("Mirror differs: {0}" -f $relativePath))
        }
    }

    if ($mirrorProblems.Count -eq 0) {
        Write-ReleaseResult "PASS" ("GitHub mirror matches {0} release files (text line endings normalized)." -f $releaseFiles.Count)
    } else {
        foreach ($problem in $mirrorProblems) {
            Write-ReleaseResult "FAIL" $problem
        }
    }
}

Write-Host ""
Write-Host ("Results: {0} passed, {1} warnings, {2} failed." -f $script:PassCount, $script:WarningCount, $script:FailureCount) -ForegroundColor Cyan

if ($script:FailureCount -gt 0) {
    Write-Host "Release check failed. Fix the items above before pushing." -ForegroundColor Red
    exit 1
}

Write-Host "Release check passed. The portal is ready for a controlled push." -ForegroundColor Green
exit 0
