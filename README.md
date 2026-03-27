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
- **Kaldığın Yerden Devam**: Son çalıştığınız filtre, konu ve kart konumu otomatik geri yüklenir.
- **Set-Bazlı Kart Kimliği**: Değerlendirmeler set bazlı anahtarlanır; aynı soru metni farklı setlerde birbirini ezmez.
- **Otomatik Legacy Migration**: Eski soru-hash (`c...`) değerlendirme kayıtları yeni set-bazlı anahtarlara otomatik taşınır.
- Değerlendirme bazlı filtreler: Tümü, Tekrar Göz At, Bilmiyorum, Değerlendirilmemiş
- Karıştırma (shuffle), Açık/Koyu tema, Kart numarasına atlama
- **Opsiyonel Otomatik Geçiş**: Değerlendirme sonrası bir sonraki karta otomatik geçişi giriş ekranından açıp kapatabilirsiniz (ayar kalıcıdır).
- **Bulut Senkronu**: Aynı Supabase hesabında set değişiklikleri ve çalışma ilerlemesi cihazlar arasında paylaşılır. Ayrı bir ilerleme tablosu yoksa uygulama bunu mevcut set tablosunda görünmeyen küçük bir kayıtla otomatik sürdürür.
- Klavye kısayolları
- `localStorage` ile durum kaydı

## Dosya Yapısı

- `index.html`: Uygulamanın tamamı (arayüz, dosya okuyucu, iş mantığı)
- `tools/md2json.js`: Markdown formatındaki soruları JSON'a dönüştüren yardımcı CLI aracı

## Çalıştırma

1. `index.html` dosyasını tarayıcıda açın.
2. "📂 JSON Dosyası Yükle" butonuna tıklayarak oluşturduğunuz JSON dosyalarını seçin.
3. Çalışmak istediğiniz setleri işaretleyip "Başla" diyin.

## Supabase Notu

- Yeni sürümlerde set ilerlemesi için ekstra SQL çalıştırmak zorunlu değil.
- `flashcard_user_state` tablosu varsa uygulama onu kullanır.
- Bu tablo yoksa ilerleme senkronu otomatik olarak `flashcard_sets` içinde gizli ve çok küçük bir sistem kaydıyla devam eder.
- [`docs/SUPABASE_SYNC_SETUP.sql`](docs/SUPABASE_SYNC_SETUP.sql) dosyası halen kullanılabilir; bu sadece ayrık bir tablo tercih ediyorsanız opsiyoneldir.
- `flashcard_sets` için temel kurtarma şeması [`docs/SUPABASE_FLASHCARD_SETS_SETUP.sql`](docs/SUPABASE_FLASHCARD_SETS_SETUP.sql) içinde tutulur.
- En kolay kişisel bulut yedeği için uygulama hesabınla giriş yapıp kendi verini dışa al:

```powershell
npm run backup:cloud-user
```

- Bu komut DB şifresi veya Docker istemez; normal uygulama giriş e-postası ve şifresi yeterlidir.
- Ücretsiz planda düzenli dışa aktarma almak için:

```powershell
$env:SUPABASE_DB_URL="postgresql://<gercek-baglanti-dizesi>"
npm run backup:supabase
```

- Ayrıntılı notlar için [`docs/SUPABASE_FREE_PLAN_BACKUP.md`](docs/SUPABASE_FREE_PLAN_BACKUP.md) dosyasına bakın.

## Desktop Release Alma (Otomatik)

Tek komutla her seferinde güncel ve tutarlı build almak için:

```powershell
npm run release
```

Bu komut sırasıyla:

1. `index.html` -> `dist/index.html` güncellemesini yapar
2. `npx tauri build --bundles nsis` ile kurulum dosyasını üretir
3. Portable (`app.exe`) + kurulum (`*-setup.exe`) çıktısını `release/` altında versiyon+commit isimleriyle saklar
4. `LATEST_RELEASE_POINTER.txt` ve `release/.../OPEN_THIS_PORTABLE.txt` dosyalarını yazarak testte açılması gereken EXE yolunu netleştirir

`npm run release` varsayılan olarak kökteki legacy EXE adlarını güncellemez.

Kökteki eski isimleri güncellemeden sadece `release/` üretmek için:

```powershell
npm run release:no-legacy
```

Legacy kök dosya adlarını bilerek güncellemek için:

```powershell
npm run release:with-legacy
```

## Desktop Auto-Updater

- Desktop uygulamasi canli web sitesinin birebir mirror'i degildir; build anindaki `dist` snapshot'ini paketler ve offline calismaya devam eder.
- Web `Deploy Pages` akisi yalnizca [asklepioszealot.me](https://asklepioszealot.me) tarafini gunceller.
- Desktop kullanicilarinin yeni surumu gormesi icin GitHub Actions altindaki `Release Desktop` workflow'unun manuel calistirilmasi gerekir.
- Workflow, GitHub Releases uzerinde updater icin gereken `latest.json` dosyasini da olusturur; uygulama acilisinda ve `Guncellemeleri Kontrol Et` butonunda bu kanal sorgulanir.
- Updater public key `src-tauri/tauri.conf.json` icinde tanimlidir. Private key'i bir kez uretmek icin:

```powershell
npx tauri signer generate -w ~/.tauri/flashcards-app-updater.key
```

- GitHub Secrets olarak en az `TAURI_SIGNING_PRIVATE_KEY` eklenmelidir. Key parola korumaliysa `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` da eklenir.

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

1. Chatbot'tan aldığınız cevabı bir `.md` (örneğin `yeni_konu.md`) dosyasına kaydedin.
2. `index.html` sayfasındaki **📂 Kart Seti Yükle** butonuna tıklayarak bu `.md` dosyasını doğrudan seçebilirsiniz.
3. Uygulama metni arka planda JSON formatına dönüştürüp listeleyecektir.

*(Not: Terminal üzerinden çeviri yapmak isterseniz `node tools/md2json.js yeni_konu.md` komutuyla JSON çıktısı alabilirsiniz.)*

## Uyarı

Bu araç eğitim amaçlıdır. Klinik kararlar için güncel kılavuzlar ve uzman hekim değerlendirmesi esas alınmalıdır.
signed by AsklepiosZealot

## Smoke Test (Playwright)

Temel duman testlerini calistirmak icin:

```powershell
npm run test:smoke
```

Bu komut önce `dist/` snapshot'ını yeniden üretir ve testleri `dist/index.html` üstünden çalıştırır.

Ilk kurulumda tarayici binary'si lazimsa:

```powershell
npm run test:smoke:install
```

## Buyume Icin Klasor Standarti

- `src/`: modulerlesme icin hedef kaynak klasoru
- `tests/smoke/`: kritik akis smoke testleri
- `docs/RELEASE_CHECKLIST.md`: release adimlari
- `docs/MODULARIZATION_PLAN.md`: index.html -> moduler yapi gecis plani
- `CHANGELOG.md`: degisiklik kaydi
