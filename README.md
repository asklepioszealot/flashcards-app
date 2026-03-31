# Flashcards App

Flashcards App, kendi kart setlerinle hizli tekrar yapmak icin hazirlanmis bir web ve desktop calisma uygulamasidir.

Uygulama ile:

- Kart setlerini yukleyip hemen calismaya baslayabilirsin
- Hangi kartlari cozdgunu ve hangilerine tekrar bakman gerektigini gorebilirsin
- Kaldigin yerden devam edebilirsin
- Istersen hesabinla giris yapip ilerlemeni bulutta saklayabilirsin

## Neler Sunar

- JSON, Markdown ve metin dosyalarindan kart seti yukleme
- Birden fazla seti birlikte kullanma
- Tamam, Tekrar Goz At ve Bilmiyorum seklinde kart durumu takibi
- Filtreleme, karistirma ve hizli kart gecisi
- Otomatik kayit ile kaldigin yerden devam etme
- Supabase ile istege bagli bulut senkronu
- Desktop surumunde guncelleme kontrolu

## Kullanim

1. Uygulamayi ac.
2. Kart setini yukle.
3. Calismak istedigin setleri sec.
4. Karti cevir, cevabini degerlendir ve devam et.

Klavye kisayollari:

- `Space`: Karti cevir
- `←` ve `→`: Kartlar arasinda gezin
- `1`: Tamam
- `2`: Tekrar Goz At
- `3`: Bilmiyorum

## Bulut Senkronu

Bulut senkronu kullanacaksan Supabase tarafinda gerekli SQL dosyalarini bir kez calistirman yeterlidir:

- [docs/SUPABASE_SYNC_SETUP.sql](docs/SUPABASE_SYNC_SETUP.sql)
- [docs/SUPABASE_USER_STATE_MIGRATION.sql](docs/SUPABASE_USER_STATE_MIGRATION.sql)
- Medya yukleme kullanacaksan [docs/SUPABASE_MEDIA_STORAGE_SETUP.sql](docs/SUPABASE_MEDIA_STORAGE_SETUP.sql)

Bu adimlardan sonra setlerin ve ilerlemen hesabinla birlikte senkron olur.

## Web ve Desktop

- Web surumu: [asklepioszealot.me](https://asklepioszealot.me)
- Desktop surumu GitHub Releases uzerinden dagitilir

## Teknik Not

Projeyi yerelde calistirmak istersen:

```powershell
npm install
npm run dev
```

Smoke test icin:

```powershell
npm run test:smoke
```

Daha detayli teknik dokumanlar `docs/` klasorundedir.

## Not

Bu uygulama egitim amaclidir. Klinik kararlar icin guncel kilavuzlar ve uzman hekim degerlendirmesi esas alinmalidir.
