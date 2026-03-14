# Release Checklist

## Pre-flight

- `git status` temiz ya da beklenen degisiklikler net.
- Dogru branch ve dogru committe oldugundan emin ol.
- Gerekliyse `git pull --rebase` ile guncelle.

## Quality Gates

- `npm run test:smoke` basarili.
- Uygulama acilisinda kritik akislar manuel kontrol edildi (tema, dosya yukleme, basla).

## Build

- `npm run release` (veya `npm run release:no-legacy`) calistir.
- `release/` altindaki yeni klasorun olustugunu dogrula.
- SHA256 hash degerlerini not et.

## Signing

- Imzalama gerekiyorsa `SIGN_*` env degiskenlerini ayarla.
- Loglarda `[5/6] Signing artifacts...` adimini dogrula.
- `Get-AuthenticodeSignature <exe>` ile imza durumunu kontrol et.

## Distribution

- Dogru `Portable` ve `Kurulum` dosyasini paylastigindan emin ol.
- Defender/SmartScreen testini temiz bir makinede dogrula.
- `CHANGELOG.md` icin surum notunu guncelle.
