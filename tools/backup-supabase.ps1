param(
  [string]$DbUrl = $env:SUPABASE_DB_URL,
  [string]$OutputRoot = (Join-Path $PSScriptRoot "..\\backups\\supabase"),
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-DockerReady {
  $dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $dockerCommand) {
    throw "Docker bulunamadi. Bu komut icin Docker Desktop kurulu ve calisiyor olmali."
  }

  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Docker kurulu gorunuyor ama daemon hazir degil. Docker Desktop'i baslatin ve `docker info` komutunun hatasiz calistigini dogrulayin."
  }
}

if ([string]::IsNullOrWhiteSpace($DbUrl)) {
  throw "Supabase DB baglanti dizesi gerekli. SUPABASE_DB_URL ortam degiskenini ayarlayin veya -DbUrl verin. Not: CLI, baglanti dizesinin percent-encoded olmasini bekler."
}

if ($DbUrl.Trim() -match '^postgres(ql)?://\.\.\.$') {
  throw "SUPABASE_DB_URL icin README'deki ornek placeholder kullaniliyor. Bunu Supabase Dashboard > Connect ekranindaki gercek Postgres baglanti dizesi ile degistirin."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputRootFull = [System.IO.Path]::GetFullPath($OutputRoot)
$runDir = Join-Path $outputRootFull $timestamp

$commands = @(
  @{
    Description = "Dump cluster roles"
    Args = @("supabase", "db", "dump", "--db-url", $DbUrl, "--role-only", "-f", (Join-Path $runDir "roles.sql"))
  },
  @{
    Description = "Dump public schema"
    Args = @("supabase", "db", "dump", "--db-url", $DbUrl, "--schema", "public", "-f", (Join-Path $runDir "public-schema.sql"))
  },
  @{
    Description = "Dump public data"
    Args = @("supabase", "db", "dump", "--db-url", $DbUrl, "--schema", "public", "--data-only", "--use-copy", "-f", (Join-Path $runDir "public-data.sql"))
  }
)

if ($DryRun) {
  Write-Host "Dry run. Komutlar calistirilmadi."
  foreach ($command in $commands) {
    Write-Host ""
    Write-Host "# $($command.Description)"
    Write-Host ("npx " + ($command.Args -join " "))
  }
  Write-Host ""
  Write-Host "Cikti klasoru: $runDir"
  exit 0
}

Test-DockerReady

New-Item -ItemType Directory -Force -Path $runDir | Out-Null

foreach ($command in $commands) {
  Write-Host "==> $($command.Description)"
  & npx @($command.Args)
  if ($LASTEXITCODE -ne 0) {
    throw "Komut basarisiz oldu: $($command.Description)"
  }
}

Write-Host ""
Write-Host "Yedekler olusturuldu: $runDir"
