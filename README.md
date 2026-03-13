# Flashcards App

Modüler, JSON-tabanlı ve dinamik set yönetimli pediatri çalışma uygulaması.  
Kartları çevirerek soru-cevap çalışabilir, kartları değerlendirebilir ve farklı konu setlerini yöneterek ilerlemenizi takip edebilirsiniz.

## Özellikler

- **Dinamik Set Yönetimi**: İstediğiniz JSON soru setlerini tarayıcıdan yükleme
- **Çoklu Set Desteği**: Birden fazla JSON setini aynı anda yükleme ve birleştirme
- Flashcard arayüzü (soru/cevap çevirme)
- **Kalıcı Değerlendirme Sistemi**: Kart değerlendirmeleriniz set yöneticisinden bağımsız kaydedilir (seti silseniz bile veriler kaybolmaz):
  - `Tamam` (`know`)
  - `Tekrar Göz At` (`review`)
  - `Bilmiyorum` (`dunno`)
- Değerlendirme bazlı filtreler: Tümü, Tekrar Göz At, Bilmiyorum, Değerlendirilmemiş
- Karıştırma (shuffle), Açık/Koyu tema, Kart numarasına atlama
- Klavye kısayolları
- `localStorage` ile durum kaydı

## Dosya Yapısı

- `index.html`: Uygulamanın tamamı (arayüz, dosya okuyucu, iş mantığı)
- `data/`: JSON formatındaki örnek flashcard soru setleri
- `tools/md2json.js`: Markdown formatındaki soruları JSON'a dönüştüren yardımcı CLI aracı

## Çalıştırma

1. `index.html` dosyasını tarayıcıda açın.
2. "📂 JSON Dosyası Yükle" butonuna tıklayarak `data/` klasöründeki veya oluşturduğunuz JSON dosyalarını seçin.
3. Çalışmak istediğiniz setleri işaretleyip "Başla" diyin.

## Kullanım

- Kartı çevirmek için karta tıklayın veya `Space` tuşuna basın.
- Gezinmek için `←` ve `→` kullanın.
- Cevap yüzündeyken değerlendirme için klavye: `1` (Tamam), `2` (Tekrar Göz At), `3` (Bilmiyorum)
- Uygulama, yüklediğiniz veri setlerini ve değerlendirmelerinizi tarayıcınızın belleğinde (`localStorage`) otomatik olarak hatırlar.

## Yeni Kart Ekleme ve AI ile Soru Oluşturma

Artık sorular doğrudan HTML içinde gömülü değil, JSON dosyalarında tutulur. Kendi sorularınızı kolayca oluşturmak için AI chatbot'larından yardım alabilirsiniz.

### 1. Chatbot'a Verilecek Prompt

Aşağıdaki komutu chatbot'a kopyalayın:

```text
[KONU İSMİ] hakkında kapsamlı flashcard soruları oluştur.

Aşağıdaki Markdown formatını birebir kullan:

## [Konu Adı]

### Soru metni buraya?

Cevap metni buraya. Birden fazla paragraf olabilir.

Kurallar:
- Her soru bir ### başlığı olmalı
- Cevap, bir sonraki ### başlığına kadar olan tüm metin
- En kritik bilgileri (sayısal değerler, tanımlar, temel kavramlar) ==çift eşittir== içine al
- Normal vurgular için **kalın** kullan
- Uyarı veya dikkat notu için > ⚠️ ile başlayan satır kullan
- İlk ## başlığı konu adıdır, tüm kartların subject'i bu olur
- Farklı bir alt konu varsa yeni bir ## başlığı aç
```

### 2. Çıktıyı JSON'a Dönüştürme

1. Chatbot'tan aldığınız cevabı bir `.md` (örneğin `data/yeni_konu.md`) dosyasına kaydedin.
2. Terminalde proje dizinine gidin ve Node.js aracıyla dönüştürün:
   ```bash
   node tools/md2json.js data/yeni_konu.md
   ```
3. Araç, aynı dizinde `data/yeni_konu.json` dosyasını oluşturacaktır.
4. `index.html` üzerinden JSON dosyasını uygulamaya ekleyebilirsiniz.

## Uyarı

Bu araç eğitim amaçlıdır. Klinik kararlar için güncel kılavuzlar ve uzman hekim değerlendirmesi esas alınmalıdır.
signed by AsklepiosZealot
