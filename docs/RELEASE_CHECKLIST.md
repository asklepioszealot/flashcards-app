# Release Checklist

## Pre-flight

- `git status` temiz ya da beklenen degisiklikler net.
- Dogru branch ve dogru committe oldugundan emin ol.
- Gerekliyse `git pull --rebase` ile guncelle.

## Quality Gates

- `npm run test:smoke` basarili.
- Uygulama acilisinda kritik akislar manuel kontrol edildi (tema, dosya yukleme, basla).

## Build

- `npm run release` (varsayilan: legacy kok EXE kopyalamaz) calistir.
- `release/` altindaki yeni klasorun olustugunu dogrula.
- `LATEST_RELEASE_POINTER.txt` ve `release/.../OPEN_THIS_PORTABLE.txt` dosyalarindaki portable yolunun ayni oldugunu kontrol et.
- Test icin her zaman pointer dosyasinda yazan portable EXE'yi ac.
- SHA256 hash degerlerini not et.

## Signing

- Imzalama gerekiyorsa `SIGN_*` env degiskenlerini ayarla.
- Loglarda `[5/6] Signing artifacts...` adimini dogrula.
- `Get-AuthenticodeSignature <exe>` ile imza durumunu kontrol et.

## Distribution

- Dogru `Portable` ve `Kurulum` dosyasini paylastigindan emin ol.
- Defender/SmartScreen testini temiz bir makinede dogrula.
- `CHANGELOG.md` icin surum notunu guncelle.
