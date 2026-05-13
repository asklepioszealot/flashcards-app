# Android Geliştirme Ortamı Kurulumu

Bu doküman, Flashcards App'i Android telefon için derleyebilmen için bilgisayarına kurulması gereken yazılımları **adım adım** anlatır. Bilgisayar deneyimi az olan biri için yazıldı. Komutları kopyala-yapıştır kullan.

> **Hedef cihaz:** Android 9+ telefonlar (Tecno Camon ve daha güncel modeller dahil).
> **Hedef bilgisayar:** Windows 11 (sen-PC).
> **Tahmini süre:** İndirmeler hariç 30-45 dakika. İndirme süresi internet hızına bağlı.

---

## 0. Başlamadan önce

- **Disk alanı:** En az **15 GB boş** alan ayır. Android Studio + SDK + NDK büyük.
- **Yönetici izni:** Bazı kurulumlar "yönetici olarak çalıştır" ister, sorduğunda **Evet** de.
- **Tarayıcı:** Bu adımlarda Chrome/Edge kullan.
- **İnternet:** Sabit bağlantı şart, indirmeler durursa devam etmez.

---

## 1. Java JDK 17 kur

> **Neden:** Android uygulamalarını derleyen "Gradle" aracı Java istiyor. Versiyon 17 önerilen sürüm.

### Adımlar

1. Tarayıcıda aç: https://adoptium.net/temurin/releases/?version=17
2. Sayfa açıldığında üstte filtreler var:
   - **Operating System:** Windows
   - **Architecture:** x64
   - **Package Type:** JDK
   - **Version:** 17 - LTS
3. Listede şu satırı bul ve **`.msi`** uzantılı dosyayı indir:
   - Örnek dosya adı: `OpenJDK17U-jdk_x64_windows_hotspot_17.0.X_Y.msi`
4. İndirilen `.msi` dosyasına çift tıkla → kurulum sihirbazı açılır.
5. Sihirbazda **"Next"** → **"Next"** ile ilerle.
6. **Önemli ekran**: "Custom Setup" başlıklı pencerede aşağıdaki seçeneklerin **hepsini** aktif et (kırmızı çarpı varsa tıklayıp "Will be installed on local hard drive" seç):
   - ✅ Set JAVA_HOME variable
   - ✅ Add to PATH
   - ✅ JavaSoft (Oracle) registry keys
7. **"Next"** → **"Install"** → bitince **"Finish"**.

### Doğrulama

- Başlat menüsünden **PowerShell** aç (yönetici değil, normal).
- Şu komutu yapıştır ve Enter:
  ```powershell
  java -version
  ```
- Çıktıda **"17.0.X"** içeren bir satır görürsen ✅ tamam.
- Şunu da test et:
  ```powershell
  $env:JAVA_HOME
  ```
- Çıktı boş **olmamalı**, `C:\Program Files\Eclipse Adoptium\jdk-17...` benzeri bir yol görmelisin.

> **Sorun:** Komutlar bulunamıyor diyorsa PowerShell'i kapat, **yeniden** aç (env değişkenleri yeni terminal oturumlarında devreye girer).

---

## 2. Android Studio kur

> **Neden:** Android SDK, NDK ve emülatörü buradan kuracağız. Sadece kurulumu için lazım, kod yazmak için kullanmayacağız.

### Adımlar

1. Tarayıcıda aç: https://developer.android.com/studio
2. **"Download Android Studio"** mavi butonuna bas.
3. Lisans sözleşmesini kabul et → **"Download Android Studio for Windows"** butonuna bas.
4. İndirilen `.exe` dosyasına çift tıkla (örnek: `android-studio-2024.X.X.X-windows.exe`).
5. Kurulum sihirbazı:
   - **"Next"** → **"Next"** (Components: hepsi seçili kalsın) → **"Next"**.
   - Kurulum yolunu **olduğu gibi bırak** (`C:\Program Files\Android\Android Studio`).
   - **"Install"** → bekle (5-10 dakika sürebilir) → **"Finish"**.
6. Android Studio otomatik açılır. İlk açılışta sorulan ekranlar:
   - **"Import settings"** → **"Do not import settings"** → OK.
   - **"Help improve..."** → **"Don't send"** (veya istediğini seç).
   - **"Welcome"** ekranında **"Next"**.
   - **"Install Type"** → **"Standard"** seç → **"Next"**.
   - **"Select UI Theme"** → istediğini seç → **"Next"**.
   - **"Verify Settings"** ekranında ne indireceğini özetler → **"Next"** → **"Accept" (lisans)** → **"Finish"**.
   - **Burada büyük bir indirme başlar** (~3-4 GB). Bitmesini bekle.
7. İndirme bitince **"Finish"** → "Welcome to Android Studio" ekranı açılır.

> Bu noktada Android Studio'yu **kapatma**, henüz SDK manager'dan ek bileşenler kuracağız.

---

## 3. SDK Manager ile NDK ve doğru SDK sürümlerini kur

> **Neden:** Tauri'nin Android için kullandığı C++ derleyici (NDK) ve hedeflediğimiz Android sürümleri (SDK 28 ve SDK 35) gerek.

### Adımlar

1. Android Studio Welcome ekranındaysan: sağ üstte üç nokta ikonu (⋮) veya **"More Actions"** → **"SDK Manager"** seç.
2. Bir proje açıksa: üst menüden **"Tools"** → **"SDK Manager"**.
3. Açılan pencerede **3 sekme** var: "SDK Platforms", "SDK Tools", "SDK Update Sites".

### 3.1 — SDK Platforms sekmesi

1. Sağ altta **"Show Package Details"** kutusunu işaretle. Bu, alt seçenekleri açar.
2. Listede şunları bul ve aşağıdaki **alt** maddeleri işaretle:

   **Android 15.0 ("VanillaIceCream") — API 35** altında:
   - ✅ Android SDK Platform 35

   **Android 9.0 ("Pie") — API 28** altında:
   - ✅ Android SDK Platform 28

   > İhtiyacımız olmayanları seçme, gereksiz yer kaplar.

### 3.2 — SDK Tools sekmesi

1. **"Show Package Details"** kutusu hâlâ işaretli olmalı.
2. Şunları bul ve işaretle (zaten işaretliyse dokunma):
   - ✅ **Android SDK Build-Tools** → en son sürüm (örn. 35.0.0)
   - ✅ **Android SDK Command-line Tools (latest)**
   - ✅ **Android SDK Platform-Tools**
   - ✅ **NDK (Side by side)** → en son sürüm (örn. 26.X veya 27.X)
   - ✅ **CMake** → en son sürüm

### 3.3 — Kuruluma başla

1. Sağ altta **"Apply"** veya **"OK"** butonuna bas.
2. Lisans sözleşmesi açılır → her birini seç, **"Accept"** → **"Next"**.
3. İndirme + kurulum başlar (3-5 GB, 10-20 dakika sürebilir).
4. Bittiğinde **"Finish"**.

### 3.4 — SDK kurulum yolunu öğren

1. SDK Manager hâlâ açıksa, en üstte **"Android SDK Location"** yazıyor.
2. Bu yolu **kopyala**, bir Notepad'e yapıştır, kaybetme. Genelde:
   ```
   C:\Users\Ahmet\AppData\Local\Android\Sdk
   ```
3. SDK Manager'ı kapat. Android Studio'yu da kapatabilirsin.

---

## 4. Environment değişkenlerini ayarla

> **Neden:** Komut satırı araçları, Android SDK ve NDK'nın **nerede** olduğunu bilmek zorunda.

### Adımlar

1. Başlat menüsünde **"environment"** yaz → **"Edit the system environment variables"** sonucuna tıkla.
2. Açılan pencerede sağ altta **"Environment Variables..."** butonuna bas.
3. **"User variables for Ahmet"** bölümüne odaklan (üstteki kutu, "System variables" değil).

### 4.1 — `ANDROID_HOME` ekle

1. **"New..."** butonuna bas.
2. **Variable name:** `ANDROID_HOME`
3. **Variable value:** SDK yolu (3.4'te kopyaladığın). Örn:
   ```
   C:\Users\Ahmet\AppData\Local\Android\Sdk
   ```
4. **"OK"**.

### 4.2 — `ANDROID_SDK_ROOT` ekle (aynı değer)

1. **"New..."** → **Variable name:** `ANDROID_SDK_ROOT` → **Variable value:** aynı SDK yolu → **"OK"**.

### 4.3 — `NDK_HOME` ekle

1. Önce NDK sürüm klasörünü öğren: Dosya Gezgini'nde şu yola git:
   ```
   C:\Users\Ahmet\AppData\Local\Android\Sdk\ndk
   ```
2. İçindeki klasör adını (örnek: `26.3.11579264`) kopyala.
3. **"New..."** → **Variable name:** `NDK_HOME` → **Variable value:**
   ```
   C:\Users\Ahmet\AppData\Local\Android\Sdk\ndk\26.3.11579264
   ```
   (kendi sürüm numaranı yaz).
4. **"OK"**.

### 4.4 — `Path`'e eklemeler

1. User variables listesinde **"Path"** satırına çift tıkla (veya seç → "Edit").
2. Açılan pencerede sağda **"New"** butonuna bas, sırasıyla şu **3 satırı** ekle:
   ```
   %ANDROID_HOME%\platform-tools
   %ANDROID_HOME%\emulator
   %ANDROID_HOME%\cmdline-tools\latest\bin
   ```
3. **"OK"** → **"OK"** → **"OK"** (üç pencereyi de kapat).

### Doğrulama

1. **Açık olan tüm PowerShell pencerelerini kapat.** (Env değişiklikleri yeni terminallere yansır.)
2. Yeni bir PowerShell aç:
   ```powershell
   adb --version
   ```
   Çıktı: `Android Debug Bridge version 1.0.XX` benzeri → ✅
3. ```powershell
   $env:ANDROID_HOME
   ```
   Çıktı: SDK yolu → ✅
4. ```powershell
   $env:NDK_HOME
   ```
   Çıktı: NDK yolu → ✅

> **Sorun:** "adb tanınmıyor" hatası alıyorsan PowerShell'i kapat-aç. Hâlâ olmuyorsa Adım 4'ü dikkatlice tekrar et.

---

## 5. Rust Android hedeflerini kur

> **Neden:** Uygulamanın Rust tarafı her Android işlemci mimarisi için ayrı derlenir (telefonlarda farklı çipler var).

### Adımlar

1. Yeni bir PowerShell aç.
2. Şu komutu yapıştır ve Enter:
   ```powershell
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```
3. 1-3 dakika sürer, "info: downloading component..." satırları görürsün.
4. Bitince doğrula:
   ```powershell
   rustup target list --installed
   ```
5. Çıktıda **şu 4 satırın hepsi olmalı** (Windows hedefiyle birlikte):
   ```
   aarch64-linux-android
   armv7-linux-androideabi
   i686-linux-android
   x86_64-linux-android
   x86_64-pc-windows-msvc
   ```

---

## 6. Proje bağımlılıklarını kur

> **Neden:** Tauri CLI gibi Node.js paketleri henüz kurulmamış.

### Adımlar

1. PowerShell'de proje klasörüne git:
   ```powershell
   cd "D:\Git Projelerim\flashcards-app"
   ```
   > Eğer worktree klasöründeysek (Claude ile çalışıyorsak) yol farklı olabilir, Claude söyleyecek.
2. ```powershell
   npm install
   ```
3. 1-3 dakika sürer, "added X packages" yazınca tamam.
4. Doğrula:
   ```powershell
   npm run tauri -- --version
   ```
   Çıktı: `tauri-cli 2.X.X` → ✅

---

## 7. Son kontrol — her şey hazır mı?

Yeni bir PowerShell aç, sırayla şunları çalıştır. **Her birinden bir çıktı görmen lazım**:

```powershell
java -version
$env:JAVA_HOME
adb --version
$env:ANDROID_HOME
$env:NDK_HOME
rustup target list --installed
cargo --version
npm run tauri -- --version
```

Hepsi cevap veriyorsa → 🎉 **Kurulum tamamlandı.** Claude'a "kurulum bitti" de, devam edelim.

---

## 8. Sorun çıkarsa

| Hata | Olası sebep | Çözüm |
|------|-------------|-------|
| `adb not recognized` | Path eksik veya terminal yenilenmedi | PowerShell'i kapat-aç. Hâlâ olmuyorsa Adım 4.4 |
| `java not recognized` | JDK kurulurken "Add to PATH" işaretlenmedi | JDK'yı kaldır, Adım 1'i baştan, 6. adımdaki kutuyu işaretle |
| Android Studio "SDK Manager bulunamadı" | İlk kurulum eksik kaldı | Android Studio'yu aç → "More Actions" → "Settings" → "Languages & Frameworks" → "Android SDK" |
| `npm install` SSL/network hatası | Antivirüs veya proxy | Antivirüsü geçici kapat, tekrar dene. Hâlâ olmazsa Claude'a hatayı yapıştır |
| Disk dolu | C: sürücüsünde yer yok | SDK Manager'da kurulum yolunu D: gibi başka diske al (yeniden kurulum gerekir) |

> Yukarıdaki tablo dışında bir hata gördüysen, hatanın **tam metnini** Claude'a yapıştır. Birlikte çözeriz.

---

## 9. Bundan sonra ne olacak?

Kurulum bittikten sonra Claude şu adımları yürütecek (sen sadece arada onay vereceksin):

1. **`tauri android init`** — Android için Gradle proje iskeletini oluşturur.
2. **Debug APK build** — ilk derleme denemesi, hatalar varsa düzeltilir.
3. **Emülatör testi** — Android Studio'da sanal telefon kurulur, uygulama orada açılır.
4. **Telefon testi** — kendi telefonunda USB ile yüklenir (USB debugging açman gerekecek, o noktada Claude anlatır).

Şimdilik tek görevin yukarıdaki 6 adımı tamamlamak. Bir takıldığın yerde sor.
