param(
  [switch]$NoLegacyCopy
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Push-Location $repoRoot
try {
  Write-Host "[1/5] Building dist from index.html..."
  node build.mjs
  if ($LASTEXITCODE -ne 0) {
    throw "node build.mjs failed with exit code $LASTEXITCODE"
  }

  Write-Host "[2/5] Building desktop app (NSIS)..."
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

  Write-Host "[3/5] Copying artifacts to release folder..."
  Copy-Item -Path $portableSource -Destination $portableTarget -Force
  Copy-Item -Path $setupSource.FullName -Destination $setupTarget -Force

  if (-not $NoLegacyCopy) {
    Write-Host "[4/5] Syncing legacy root file names..."
    Copy-Item -Path $portableSource -Destination (Join-Path $repoRoot "Pediatri_Flashcards_Portable.exe") -Force
    Copy-Item -Path $setupSource.FullName -Destination (Join-Path $repoRoot "Pediatri_Flashcards_Kurulum.exe") -Force
  } else {
    Write-Host "[4/5] Skipping legacy root file names (-NoLegacyCopy)."
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

  Write-Host "[5/5] Done."
  Write-Host ""
  Write-Host "Release folder: $releaseDir"
  Write-Host "Portable: $portableTarget"
  Write-Host "Portable SHA256: $portableHash"
  Write-Host "Setup: $setupTarget"
  Write-Host "Setup SHA256: $setupHash"
} finally {
  Pop-Location
}
