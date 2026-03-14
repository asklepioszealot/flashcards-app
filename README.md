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

## Desktop Release Alma (Otomatik)

Tek komutla her seferinde güncel ve tutarlı build almak için:

```powershell
npm run release
```

Bu komut sırasıyla:

1. `index.html` -> `dist/index.html` güncellemesini yapar
2. `npx tauri build --bundles nsis` ile kurulum dosyasını üretir
3. Portable (`app.exe`) + kurulum (`*-setup.exe`) çıktısını `release/` altında versiyon+commit isimleriyle saklar
4. İsterseniz eski kök dosya adlarını da (`Pediatri_Flashcards_Portable.exe`, `Pediatri_Flashcards_Kurulum.exe`) otomatik günceller

Kökteki eski isimleri güncellemeden sadece `release/` üretmek için:

```powershell
npm run release:no-legacy
```

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

**Persona ve Kaynaklar:**
- Yazarken pediatri uzmanı bir hoca gibi düşün ve bir tıp öğrencisine bu konudan neleri sorardın, hangi cevapları beklerdin bunları kurgula.
- Kartları hazırlarken kaynak olarak Nelson Pediatrics 22th Ed, PubMed, AAP, Cochrane gibi güncel kılavuz ve textbook'ları esas alabilirsin.
- Soru sayısı tüm detayları kapsayacak kadar çok olmalı. Açıklamalar doyurucu ve öğretici olmalı.

**Format Talimatı:**
Aşağıdaki Markdown formatını birebir kullan:

Vurgu Hiyerarşisi (Cevap kısmında kullan):
- Seviye 1 (Kritik): ==metin== (Çift eşittir)
- Seviye 2 (Önemli): > ⚠️ metin (Satır başı uyarı)
- Seviye 3 (Normal): **metin** (Kalın)

## [Konu Adı]

### Soru metni buraya?

Cevap metni buraya. Birden fazla paragraf olabilir. Vurguları yukarıdaki hiyerarşiye göre yap.
```

### 2. Oluşturulan Dosyayı Yükleme

Uygulama artık `.md` veya `.txt` uzantılı düz metin dosyalarını da doğrudan destekliyor!

1. Chatbot'tan aldığınız cevabı bir `.md` (örneğin `data/yeni_konu.md`) dosyasına kaydedin.
2. `index.html` sayfasındaki **📂 Kart Seti Yükle** butonuna tıklayarak bu `.md` dosyasını doğrudan seçebilirsiniz.
3. Uygulama metni arka planda JSON formatına dönüştürüp listeleyecektir.

*(Not: Terminal üzerinden çeviri yapmak isterseniz eski `node tools/md2json.js data/yeni_konu.md` komutuyla JSON çıktısı da almaya devam edebilirsiniz.)*

## Uyarı

Bu araç eğitim amaçlıdır. Klinik kararlar için güncel kılavuzlar ve uzman hekim değerlendirmesi esas alınmalıdır.
signed by AsklepiosZealot
