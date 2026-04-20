param(
  [switch]$NoLegacyCopy,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Resolve-SignToolPath {
  if (-not [string]::IsNullOrWhiteSpace($env:SIGNTOOL_PATH)) {
    if (-not (Test-Path $env:SIGNTOOL_PATH)) {
      throw "SIGNTOOL_PATH does not exist: $($env:SIGNTOOL_PATH)"
    }
    return $env:SIGNTOOL_PATH
  }

  $signToolCmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($signToolCmd) {
    return $signToolCmd.Source
  }

  return $null
}

function Sign-Artifact {
  param(
    [Parameter(Mandatory = $true)][string]$SignTool,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string]$TimestampUrl,
    [string]$PfxPath,
    [string]$PfxPassword,
    [string]$CertThumbprint
  )

  if (-not (Test-Path $FilePath)) {
    throw "Signing target not found: $FilePath"
  }

  $args = @("sign", "/fd", "SHA256", "/td", "SHA256", "/tr", $TimestampUrl)

  if (-not [string]::IsNullOrWhiteSpace($PfxPath)) {
    $args += @("/f", $PfxPath)
    if (-not [string]::IsNullOrWhiteSpace($PfxPassword)) {
      $args += @("/p", $PfxPassword)
    }
  } elseif (-not [string]::IsNullOrWhiteSpace($CertThumbprint)) {
    $args += @("/sha1", $CertThumbprint)
  } else {
    $args += "/a"
  }

  $args += $FilePath
  & $SignTool @args
  if ($LASTEXITCODE -ne 0) {
    throw "signtool failed for $FilePath with exit code $LASTEXITCODE"
  }
}

function Assert-AuthenticodeSignature {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath
  )

  if (-not (Test-Path $FilePath)) {
    throw "Signature verification target not found: $FilePath"
  }

  $signature = Get-AuthenticodeSignature -FilePath $FilePath
  if ($signature.Status -ne "Valid") {
    throw "Authenticode verification failed for $FilePath. Status: $($signature.Status)"
  }
}

function Get-HashOrMissing {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath
  )

  if (-not (Test-Path $FilePath)) {
    return "missing"
  }

  return (Get-FileHash -Path $FilePath -Algorithm SHA256).Hash
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$localUpdaterOverridePath = $null

Push-Location $repoRoot
try {
  Write-Host "[1/6] Building dist with Vite..."
  npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build failed with exit code $LASTEXITCODE"
  }

  $sourceIndexPath = Join-Path $repoRoot "index.html"
  $sourceMainPath = Join-Path $repoRoot "src\app\main.js"
  $distIndexPath = Join-Path $repoRoot "dist\index.html"
  $distMainPath = Join-Path $repoRoot "dist\src\app\main.js"
  $buildIdPath = Join-Path $repoRoot "dist\build-id.txt"
  $buildMetadataPath = Join-Path $repoRoot "dist\build-metadata.json"
  $buildId = if (Test-Path $buildIdPath) {
    (Get-Content -Path $buildIdPath -Raw).Trim()
  } else {
    "unknown"
  }
  $sourceIndexHash = Get-HashOrMissing -FilePath $sourceIndexPath
  $sourceMainHash = Get-HashOrMissing -FilePath $sourceMainPath
  $distIndexHash = Get-HashOrMissing -FilePath $distIndexPath
  $distMainHash = Get-HashOrMissing -FilePath $distMainPath

  $tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
  $tauriConfig = Get-Content $tauriConfigPath -Raw | ConvertFrom-Json
  $productName = [string]$tauriConfig.productName
  $version = [string]$tauriConfig.version
  if ([string]::IsNullOrWhiteSpace($productName)) {
    $productName = "Flashcards App"
  }
  if ([string]::IsNullOrWhiteSpace($version)) {
    $version = "unknown"
  }

  $defaultUpdaterKeyPath = Join-Path $HOME ".tauri\flashcards-app-updater.key"
  $updaterKeySource = "missing"
  if (-not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY)) {
    $updaterKeySource = "env-inline"
  } elseif (-not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
    $updaterKeySource = "env-path"
  } elseif (Test-Path $defaultUpdaterKeyPath) {
    $updaterKeySource = "local-default"
  }
  $updaterArtifactsEnabled = $updaterKeySource -ne "missing"

  if ($updaterKeySource -eq "local-default" -and -not $DryRun) {
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Raw $defaultUpdaterKeyPath)
    Write-Host "[2/6] Using local updater key: $defaultUpdaterKeyPath"
  }

  $commit = (git rev-parse --short HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commit)) {
    $commit = "nogit"
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $releasePlanScript = Join-Path $repoRoot "tools\release-plan.mjs"
  $env:FLASHCARDS_RELEASE_BUILD_ID = $buildId
  $env:FLASHCARDS_RELEASE_COMMIT = $commit
  $env:FLASHCARDS_RELEASE_NO_LEGACY = if ($NoLegacyCopy) { "1" } else { "0" }
  $env:FLASHCARDS_RELEASE_PRODUCT_NAME = $productName
  $env:FLASHCARDS_RELEASE_REPO_ROOT = $repoRoot
  $env:FLASHCARDS_RELEASE_TIMESTAMP = $timestamp
  $env:FLASHCARDS_RELEASE_VERSION = $version
  $env:FLASHCARDS_RELEASE_DEFAULT_KEY_PATH = $defaultUpdaterKeyPath
  $env:FLASHCARDS_RELEASE_KEY_SOURCE = $updaterKeySource
  $env:FLASHCARDS_RELEASE_UPDATER_ENABLED = if ($updaterArtifactsEnabled) { "1" } else { "0" }
  $releasePlanJson = & node $releasePlanScript
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($releasePlanJson)) {
    throw "Release plan could not be generated."
  }

  $releasePlan = $releasePlanJson | ConvertFrom-Json
  $releaseDir = [string]$releasePlan.releaseDir
  $portableTarget = [string]$releasePlan.portableTarget
  $setupTarget = [string]$releasePlan.setupTarget
  $latestPointerPath = [string]$releasePlan.latestPointerPath
  $openPortableInfoPath = [string]$releasePlan.openPortableInfoPath
  $legacyPortablePath = Join-Path $repoRoot ([string]$releasePlan.artifactNames.legacyPortableName)
  $legacySetupPath = Join-Path $repoRoot ([string]$releasePlan.artifactNames.legacySetupName)

  if ($DryRun) {
    Write-Host "[2/6] Dry run mode: desktop build, artifact copy ve signing atlandi."
    Write-Host ""
    Write-Host "Planned release folder: $releaseDir"
    Write-Host "Planned portable: $portableTarget"
    Write-Host "Planned setup: $setupTarget"
    Write-Host "Planned latest pointer: $latestPointerPath"
    Write-Host "Updater key source: $($releasePlan.dryRunSummary.updaterKeySource)"
    Write-Host "Updater artifacts: $($releasePlan.dryRunSummary.updaterArtifacts)"
    Write-Host "Legacy root copy: $($releasePlan.dryRunSummary.legacyCopy)"
    Write-Host "Build ID: $buildId"
    return
  }

  $tauriBuildArgs = @("tauri", "build", "--bundles", "nsis")
  if (-not $updaterArtifactsEnabled) {
    $localUpdaterOverridePath = Join-Path ([System.IO.Path]::GetTempPath()) ("flashcards-tauri-no-updater-" + [Guid]::NewGuid().ToString("N") + ".json")
    @{ bundle = @{ createUpdaterArtifacts = $false } } |
      ConvertTo-Json -Depth 5 |
      Set-Content -Path $localUpdaterOverridePath -Encoding UTF8
    $tauriBuildArgs += @("--config", $localUpdaterOverridePath)
    Write-Warning "Updater imza anahtari bulunamadi. Local release build updater artefaktlari olmadan devam edecek."
  }

  Write-Host "[2/6] Building desktop app (NSIS)..."
  $npxCmd = "npx " + ($tauriBuildArgs -join " ")
  cmd.exe /d /s /c $npxCmd
  if ($LASTEXITCODE -ne 0) {
    throw "cmd.exe /d /s /c $npxCmd failed with exit code $LASTEXITCODE"
  }

  $portableSource = Join-Path $repoRoot "src-tauri\target\release\app.exe"
  if (-not (Test-Path $portableSource)) {
    throw "Portable source not found: $portableSource"
  }

  $nsisDir = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
  $setupSource = Get-ChildItem -Path $nsisDir -Filter "*-setup.exe" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $setupSource) {
    throw "NSIS setup file not found under: $nsisDir"
  }

  New-Item -Path $releaseDir -ItemType Directory -Force | Out-Null

  Write-Host "[3/6] Copying artifacts to release folder..."
  Copy-Item -Path $portableSource -Destination $portableTarget -Force
  Copy-Item -Path $setupSource.FullName -Destination $setupTarget -Force

  if (-not $NoLegacyCopy) {
    Write-Host "[4/6] Syncing legacy root file names..."
    Copy-Item -Path $portableSource -Destination $legacyPortablePath -Force
    Copy-Item -Path $setupSource.FullName -Destination $legacySetupPath -Force
  } else {
    Write-Host "[4/6] Skipping legacy root file names (-NoLegacyCopy)."
    if ((Test-Path $legacyPortablePath) -or (Test-Path $legacySetupPath)) {
      Write-Warning "Legacy root EXE files exist and may be stale. Use the timestamped release folder artifact."
    }
  }

  @(
    "Bu release icin test edilecek dogru portable EXE:",
    $portableTarget,
    "",
    "setup_exe=$setupTarget",
    "build_id=$buildId"
  ) | Set-Content -Path $openPortableInfoPath -Encoding UTF8

  @($releasePlan.pointerEntries) | Set-Content -Path $latestPointerPath -Encoding UTF8

  $signEnable = [string]$env:SIGN_ENABLE
  $signEnableNormalized = $signEnable.Trim()
  $signingRequired = $signEnableNormalized -eq "1"
  $signPfxPath = $env:SIGN_PFX_PATH
  $signPfxPassword = $env:SIGN_PFX_PASSWORD
  $signCertThumbprint = $env:SIGN_CERT_SHA1
  $timestampUrl = if (-not [string]::IsNullOrWhiteSpace($env:SIGN_TIMESTAMP_URL)) {
    $env:SIGN_TIMESTAMP_URL
  } else {
    "http://timestamp.digicert.com"
  }

  $signingRequested =
    $signingRequired -or
    -not [string]::IsNullOrWhiteSpace($signPfxPath) -or
    -not [string]::IsNullOrWhiteSpace($signCertThumbprint)

  if ($signingRequested) {
    Write-Host "[5/6] Signing artifacts..."
    if (-not [string]::IsNullOrWhiteSpace($signPfxPath) -and -not (Test-Path $signPfxPath)) {
      throw "SIGN_PFX_PATH not found: $signPfxPath"
    }

    $signToolPath = Resolve-SignToolPath
    if (-not $signToolPath) {
      throw "signtool.exe was not found. Add it to PATH or set SIGNTOOL_PATH."
    }

    $artifactsToSign = @($portableTarget, $setupTarget)
    if (-not $NoLegacyCopy) {
      $artifactsToSign += @($legacyPortablePath, $legacySetupPath)
    }

    foreach ($artifact in $artifactsToSign) {
      Sign-Artifact -SignTool $signToolPath -FilePath $artifact -TimestampUrl $timestampUrl -PfxPath $signPfxPath -PfxPassword $signPfxPassword -CertThumbprint $signCertThumbprint
      Assert-AuthenticodeSignature -FilePath $artifact
    }
  } else {
    if ($signingRequired) {
      throw "SIGN_ENABLE=1 set edildi ancak imzalama adimi calistirilamadi."
    }
    Write-Host "[5/6] Skipping signing (set SIGN_ENABLE=1, SIGN_PFX_PATH or SIGN_CERT_SHA1)."
  }

  $infoPath = Join-Path $releaseDir "release-info.txt"
  @(
    "version=$version"
    "commit=$commit"
    "timestamp=$timestamp"
    "build_id=$buildId"
    "portable_source=$portableSource"
    "setup_source=$($setupSource.FullName)"
    "legacy_copy=$(-not $NoLegacyCopy)"
    "source_index_sha256=$sourceIndexHash"
    "source_main_sha256=$sourceMainHash"
    "dist_index_sha256=$distIndexHash"
    "dist_main_sha256=$distMainHash"
    "dist_build_metadata=$buildMetadataPath"
    "pointer_file=$latestPointerPath"
  ) | Set-Content -Path $infoPath -Encoding UTF8

  $portableHash = (Get-FileHash -Path $portableTarget -Algorithm SHA256).Hash
  $setupHash = (Get-FileHash -Path $setupTarget -Algorithm SHA256).Hash

  Write-Host "[6/6] Done."
  Write-Host ""
  Write-Host "Release folder: $releaseDir"
  Write-Host "Portable: $portableTarget"
  Write-Host "Portable SHA256: $portableHash"
  Write-Host "Setup: $setupTarget"
  Write-Host "Setup SHA256: $setupHash"
  Write-Host "Build ID: $buildId"
  Write-Host "Open-this marker: $openPortableInfoPath"
  Write-Host "Latest pointer: $latestPointerPath"
} finally {
  if ($localUpdaterOverridePath -and (Test-Path $localUpdaterOverridePath)) {
    Remove-Item -Path $localUpdaterOverridePath -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
