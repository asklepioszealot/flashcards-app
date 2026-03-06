[README.md](https://github.com/user-attachments/files/25779771/README.md)
# Pediatri Flashcards

Tek dosyalık (`HTML + CSS + JavaScript`) bir pediatri çalışma uygulaması.  
Kartları çevirerek soru-cevap çalışabilir, kartları değerlendirebilir ve ilerlemenizi takip edebilirsiniz.

## Özellikler

- Flashcard arayüzü (soru/cevap çevirme)
- Konuya göre filtreleme (`subject`)
- Kart numarasına atlama
- Karıştırma (shuffle)
- Değerlendirme sistemi:
  - `Tamam` (`know`)
  - `Tekrar Göz At` (`review`)
  - `Bilmiyorum` (`dunno`)
- Değerlendirme bazlı filtreler:
  - Tümü
  - Tekrar Göz At
  - Bilmiyorum
  - Değerlendirilmemiş
- İlerleme özeti ve tamamlanma yüzdesi
- Açık/Koyu tema
- JSON dışa aktarma
- Yazdırma görünümü
- Klavye kısayolları
- `localStorage` ile durum kaydı (kaldığın yer + değerlendirmeler + tema + filtre)

## Dosya Yapısı

- `Pediatri Flashcards.html`: Uygulamanın tamamı (arayüz, veri seti, iş mantığı)

## Çalıştırma

1. `Pediatri Flashcards.html` dosyasını tarayıcıda açın.
2. Ek kurulum gerekmez.

## Kullanım

- Kartı çevirmek için karta tıklayın veya `Space` tuşuna basın.
- Gezinmek için `←` ve `→` kullanın.
- Cevap yüzündeyken değerlendirme için:
  - `1`: Tamam
  - `2`: Tekrar Göz At
  - `3`: Bilmiyorum
- Cevap uzun ise:
  - `↑` / `↓` ile cevap alanında kaydırma yapılabilir.

## Kart Verisi ve Yeni Kart Ekleme

Kartlar, HTML içindeki `flashcards` dizisinde tutulur.

```js
{
  q: "Soru metni",
  a: "Cevap metni (HTML destekli)",
  subject: "Konu Adı"
}
```

Notlar:

- `subject` alanı konu filtresini otomatik besler.
- Cevaplarda `<strong>`, `highlight-critical`, `highlight-important` sınıfları kullanılabilir.
- Dosyayı UTF-8 olarak kaydetmek Türkçe karakter bozulmalarını önler.

## Durum Kaydı

Uygulama aşağıdaki bilgileri tarayıcıda saklar:

- Değerlendirmeler
- Son açık kart indeksi
- Seçili tema
- Seçili konu
- Aktif değerlendirme filtresi

Kullanılan anahtar: `flashcards_state_v6`

## Dışa Aktarma / Yazdırma

- `Export`: Kartları JSON olarak indirir.
- `Yazdır`: Kartlar ve değerlendirme özetini yazdırma penceresinde açar.

## Uyarı

Bu araç eğitim amaçlıdır. Klinik kararlar için güncel kılavuzlar ve uzman hekim değerlendirmesi esas alınmalıdır.
signed by AsklepiosZealot
