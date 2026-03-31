# Changelog

Bu dosya [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) formatina gore tutulur.

## [Unreleased]

## [0.1.3] - 2026-03-31

### Changed
- Desktop release surumu `0.1.3` olarak bump edildi.
- Desktop release basligi ve GitHub asset isim ailesi `Flashcards App` olarak birlestirildi.
- Yerel release script'i timestamp'li portable ve setup kopyalarini `Flashcards App` adlariyla uretir hale getirildi.

## [0.1.2] - 2026-03-31

### Added
- Fullscreen study modu icin ayri font boyutu kontrolleri ve tipografi akisi eklendi.
- Raw editor icerigi icin auto-size davranisi iyilestirildi.

### Changed
- Desktop release surumu `0.1.2` olarak bump edildi.
- Runtime config okuma akisi `NEXT_PUBLIC_SUPABASE_*` env anahtarlarini da destekleyecek sekilde genisletildi.
- Supabase istemci paketi `@supabase/supabase-js@2.101.0` surumune guncellendi.

### Fixed
- Calisma kartlarinda cevrilmis karttan sonra gecis akisi bekleme olmadan ilerleyecek sekilde duzeltildi.
- Ayni set dosyasi kaldirilip tekrar yuklendiginde ilerleme sifirlanmasi giderildi.
- Editor kaydi sonrasi blockquote (`> ...`) satirlarinin bos satir ve ekstra `>` ureterek bozulmasi giderildi.
