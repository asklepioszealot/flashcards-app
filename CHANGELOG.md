# Changelog

Bu dosya [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) formatina gore tutulur.

## [Unreleased]

## [0.1.15] - 2026-11-16

### Added
- “Bilmiyorum” ve “Tekrar” yanıtlarından sonra kartları aynı oturumda yeniden soran tekrar kuyruğu eklendi. Kartlar “Tamam” denilene kadar geri gelir; az kart kaldığında aralık kısalır.
- Kart ayarlarına hesaba bağlı iki tekrar aralığı eklendi: varsayılan 3 ve 5 kart, ayarlanabilir aralık 1–50.
- Oturum sırası, bekleyen tekrarlar ve gezinme geçmişi kaydedilerek çalışmaya devam etme desteği eklendi.

### Fixed
- Aynı oturumda yeniden gelen karta aynı yanıtın verilmesi önceki değerlendirmeyi silmez; aynı gösterimde yanıt düzeltme/kaldırma korunur.
- Gün içindeki tekrarlar uzun vadeli tekrar aralığını üst üste büyütmez; günlük zorlanma ve son yanıt birlikte korunur.
- Hesap değişiminde çalışma oturumu ve tekrar tercihleri bellekte temizlenir.

## [0.1.14] - 2026-07-10

### Fixed
- Masaustunde Google ile giris akisi duzeltildi; giris artik uygulamaya geri donuyor.
- Masaustunde Anki paketi (.apkg) ice aktarma calisir hale getirildi.
- Dosya acma ve baglanti ile acilista uygulama penceresi artik one geliyor.
- Masaustunde bazi hata ve onay pencerelerinin hic gorunmemesi duzeltildi.

### Changed
- Desktop release surumu `0.1.14` olarak bump edildi.

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
