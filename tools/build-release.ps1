param(
  [switch]$NoLegacyCopy
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

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Push-Location $repoRoot
try {
  Write-Host "[1/6] Building dist from index.html..."
  node build.mjs
  if ($LASTEXITCODE -ne 0) {
    throw "node build.mjs failed with exit code $LASTEXITCODE"
  }

  Write-Host "[2/6] Building desktop app (NSIS)..."
  npx tauri build --bundles nsis
  if ($LASTEXITCODE -ne 0) {
    throw "npx tauri build --bundles nsis failed with exit code $LASTEXITCODE"
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

  $tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
  $tauriConfig = Get-Content $tauriConfigPath -Raw | ConvertFrom-Json
  $version = [string]$tauriConfig.version
  if ([string]::IsNullOrWhiteSpace($version)) {
    $version = "unknown"
  }

  $commit = (git rev-parse --short HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commit)) {
    $commit = "nogit"
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $releaseDir = Join-Path $repoRoot ("release\" + $timestamp + "_v" + $version + "_" + $commit)
  New-Item -Path $releaseDir -ItemType Directory -Force | Out-Null

  $portableName = "Pediatri_Flashcards_Portable_v{0}_{1}.exe" -f $version, $commit
  $setupName = "Pediatri_Flashcards_Kurulum_v{0}_{1}.exe" -f $version, $commit
  $portableTarget = Join-Path $releaseDir $portableName
  $setupTarget = Join-Path $releaseDir $setupName

  Write-Host "[3/6] Copying artifacts to release folder..."
  Copy-Item -Path $portableSource -Destination $portableTarget -Force
  Copy-Item -Path $setupSource.FullName -Destination $setupTarget -Force

  $legacyPortablePath = Join-Path $repoRoot "Pediatri_Flashcards_Portable.exe"
  $legacySetupPath = Join-Path $repoRoot "Pediatri_Flashcards_Kurulum.exe"

  if (-not $NoLegacyCopy) {
    Write-Host "[4/6] Syncing legacy root file names..."
    Copy-Item -Path $portableSource -Destination $legacyPortablePath -Force
    Copy-Item -Path $setupSource.FullName -Destination $legacySetupPath -Force
  } else {
    Write-Host "[4/6] Skipping legacy root file names (-NoLegacyCopy)."
  }

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
      throw "SIGN_ENABLE=1 set edildi ancak imzalama adımı çalıştırılamadı."
    }
    Write-Host "[5/6] Skipping signing (set SIGN_ENABLE=1, SIGN_PFX_PATH or SIGN_CERT_SHA1)."
  }

  $infoPath = Join-Path $releaseDir "release-info.txt"
  @(
    "version=$version"
    "commit=$commit"
    "timestamp=$timestamp"
    "portable_source=$portableSource"
    "setup_source=$($setupSource.FullName)"
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
} finally {
  Pop-Location
}
