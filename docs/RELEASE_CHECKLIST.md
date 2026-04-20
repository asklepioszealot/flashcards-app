# Release Checklist

## Pre-flight

- `git status` temiz ya da beklenen degisiklikler net.
- Dogru branch ve dogru committe oldugundan emin ol.
- Gerekliyse `git pull --rebase` ile guncelle.
- Desktop release oncesi `src-tauri/tauri.conf.json` icindeki `version` degerini bump et.
- GitHub Actions `vars` tarafinda `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ENABLE_DEMO_AUTH` degerlerinin guncel oldugunu dogrula.

## Quality Gates

- `npm run test:smoke` basarili.
- Uygulama acilisinda kritik akislar manuel kontrol edildi (tema, dosya yukleme, basla).

## Updater Keys

- Updater public key repo icinde `src-tauri/tauri.conf.json` altinda tanimli.
- Private key'i bir kez uretmek icin:

```powershell
npx tauri signer generate -w ~/.tauri/flashcards-app-updater.key
```

- GitHub Secrets:
  - `TAURI_SIGNING_PRIVATE_KEY`: private key icerigi veya dosya yolu
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: yalnizca key parola korumaliysa gerekli
- Local `npm run release` akisi `~/.tauri/flashcards-app-updater.key` dosyasini bulursa updater artefaktlarini da uretebilir.
- Local key yoksa `tools/build-release.ps1` updater artefaktlarini kapatip normal NSIS release almaya devam eder.

## Build

- `npm run release` (varsayilan: legacy kok EXE kopyalamaz) calistir.
- `release/` altindaki yeni klasorun olustugunu dogrula.
- `LATEST_RELEASE_POINTER.txt` ve `release/.../OPEN_THIS_PORTABLE.txt` dosyalarindaki portable yolunun ayni oldugunu kontrol et.
- Test icin her zaman pointer dosyasinda yazan portable EXE'yi ac.
- SHA256 hash degerlerini not et.

## GitHub Desktop Release

- GitHub Actions icinden `Release Desktop` workflow'unu manuel tetikle.
- Workflow, `desktop-v{version}` tag'i ile Windows NSIS installer + `latest.json` updater manifest'i olusturur.
- Workflow "tag already exists" hatasi verirse once `src-tauri/tauri.conf.json` icindeki `version` degerini artir.
- Desktop auto-updater yalnizca bu workflow ile yayinlanan GitHub Release'leri yakalar.
- `Deploy Pages` workflow'u sadece web build'ini gunceller; tek basina desktop istemciyi guncellemez.

## Signing

- Imzalama gerekiyorsa `SIGN_*` env degiskenlerini ayarla.
- Loglarda `[5/6] Signing artifacts...` adimini dogrula.
- `Get-AuthenticodeSignature <exe>` ile imza durumunu kontrol et.

## Distribution

- Dogru `Portable` ve `Kurulum` dosyasini paylastigindan emin ol.
- Defender/SmartScreen testini temiz bir makinede dogrula.
- `CHANGELOG.md` icin surum notunu guncelle.
