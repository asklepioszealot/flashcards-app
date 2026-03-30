# Changelog

Bu dosya [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) formatina gore tutulur.

## [Unreleased]

### Added
- Playwright smoke test altyapisi (`playwright.config.js`, `tests/smoke`).
- Buyume icin moduler klasor iskeleti (`src/core`, `src/features`, `src/ui`, `src/shared`).
- Dokumantasyon: `docs/RELEASE_CHECKLIST.md`, `docs/MODULARIZATION_PLAN.md`.

### Changed
- `package.json` scriptleri smoke test calistiracak sekilde guncellendi.
- `.gitignore` Playwright ciktilarini ignore edecek sekilde guncellendi.
- Desktop release surumu `0.1.1` olarak bump edildi; web ile ayni kod seviyesinden yeni desktop paketinin alinmasi saglandi.

### Fixed
- Editor kaydi sonrasi blockquote (`> ...`) satirlarinin bos satir ve ekstra `>` ureterek bozulmasi giderildi.
