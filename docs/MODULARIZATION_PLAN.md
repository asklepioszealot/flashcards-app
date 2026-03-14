# Modularization Plan

Bu plan, uygulamayi tek dosya yapisindan adim adim moduler yapiya tasimak icindir.

## Faz 1: Guvenli taban

1. `src/` klasor yapisini olustur.
2. Smoke testleri ekle (`tests/smoke`).
3. Release checklist ve changelog disiplinini aktif et.

## Faz 2: Dusuk riskli tasima

1. Tema ile ilgili kodu `src/ui/theme.js` altina tasi.
2. LocalStorage ile ilgili kodu `src/core/storage.js` altina tasi.
3. Kod tasirken global degisken sayisini azalt.

## Faz 3: Feature bazli ayrim

1. Set manager akisini `src/features/set-manager/` altina tasi.
2. Kart akisini `src/features/study-flow/` altina tasi.
3. Ortak yardimcilari `src/shared/` altinda topla.

## Hazir olma kriterleri

- Her tasimadan sonra smoke testler gecmeli.
- `release` komutu davranis degistirmeden calismali.
- README ve changelog guncel kalmali.
