# Android Release Pipeline (GitHub Actions)

Bu doküman, `.github/workflows/release-android.yml` workflow'unun ne yaptığını ve **bir kerelik kurulum** olarak GitHub'da hangi secret'ları tanımlaman gerektiğini anlatır.

> **Tek seferlik kurulum, sonra her yeni sürüm:** `tauri.conf.json` içindeki `version`'u bump et → commit → tag at → push → CI APK üretip Release'e yükler.

## Workflow özeti

`release-android.yml` iki yolla tetiklenir:

- **Otomatik:** `android-v*` ile başlayan herhangi bir tag push'landığında
- **Manuel:** GitHub Actions sekmesinden "Run workflow" → opsiyonel `version` input

Adımlar (özet):

1. JDK 17 + Android SDK 36 + NDK r27c + Node 20 + Rust (aarch64-linux-android) kur
2. `npm ci` ile bağımlılıkları yükle
3. Secret'lardan keystore + `runtime-config.local.json` üret
4. `npm run build:android` çalıştır → imzalı universal APK üretir
5. İlgili Release tag'i yoksa otomatik oluştur (release notes git history'den)
6. APK'yı release asset olarak yükle (`--clobber` ile aynı isim mevcutsa üzerine yazar)

## Bir kerelik kurulum

### 1. Release keystore'u base64'e çevir

Workflow keystore'u secret olarak okur. Base64 stringe çevir:

```powershell
$bytes = [System.IO.File]::ReadAllBytes("$env:USERPROFILE\.android\flashcards-release.jks")
[Convert]::ToBase64String($bytes) | Set-Clipboard
```

Bu komut keystore'u base64'e dönüştürüp **panoya kopyalar**. Hemen sonraki adımda yapıştıracaksın.

### 2. GitHub secret'larını ekle

GitHub'da repo sayfasına git → **Settings** → sol menü **Secrets and variables** → **Actions** → **New repository secret** ile aşağıdaki 8 secret'ı ekle:

| Secret adı | Değer |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Adım 1'de panoya kopyalanan base64 string |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore parolası (`keytool -genkey` sırasında belirledin) |
| `ANDROID_KEY_ALIAS` | `flashcards-release` |
| `ANDROID_KEY_PASSWORD` | Key parolası (genelde keystore parolasıyla aynı) |
| `SUPABASE_URL` | `runtime-config.local.json`'daki `supabaseUrl` |
| `SUPABASE_ANON_KEY` | `runtime-config.local.json`'daki `supabaseAnonKey` |
| `GOOGLE_WEB_CLIENT_ID` | `runtime-config.local.json`'daki `googleWebClientId` |
| `GOOGLE_ANDROID_CLIENT_ID` | Release Android OAuth client ID (Google Cloud'daki "Flashcards Android (release)") |

> Her secret eklemeden önce **adı tam olarak yukarıdaki gibi yaz**; küçük/büyük harf duyarlıdır. Değeri tek satıra yapıştır (base64 stringi tek satır olacak).

### 3. Workflow'u manuel olarak test et

İlk denemeyi tag push'lamadan manuel olarak yap:

1. GitHub repo sayfası → **Actions** sekmesi
2. Sol menüden **Release Android** workflow'unu seç
3. Sağ üstte **Run workflow** → branch'i `feat/android` seç → version alanını boş bırak (`tauri.conf.json`'dan okur)
4. **Run workflow** butonuna bas
5. Çalışan job'a tıkla, adımları izle. Build tipik olarak **10-15 dakika** sürer

Hata varsa kırmızı X'li adımın log'unu aç, hata satırını paste et — düzeltebiliriz.

## Yeni sürüm yayınlama (kurulum sonrası)

```powershell
cd "D:\Git Projelerim\flashcards-app\.claude\worktrees\quirky-mestorf-33a439"

# 1) tauri.conf.json içinde "version" alanını bir üst sürüme bump et (örn 0.1.4 -> 0.1.5)
notepad src-tauri/tauri.conf.json

# 2) Commit
git add src-tauri/tauri.conf.json
git commit -m "chore(android): bump version to 0.1.5"

# 3) Tag at
git tag android-v0.1.5

# 4) Hem branch hem tag'i push'la
git push origin feat/android
git push origin android-v0.1.5
```

Tag push'u workflow'u tetikler. ~15 dk sonra Release sayfasında yeni APK görünür. Emülatör/cihazda yüklü eski sürüm bir sonraki "Güncellemeleri Kontrol Et" tıklamasında bu yeni sürümü tespit eder.

## Sorun giderme

- **"Missing secret: ..." hatası:** Bir secret'ı eklemeyi unutmuşsun ya da yazımı yanlış. Settings → Secrets'tan kontrol et.
- **`keystore was tampered with, or password was incorrect`:** Yanlış parolayı secret olarak kaydetmişsin. `ANDROID_KEYSTORE_PASSWORD` ve `ANDROID_KEY_PASSWORD` secret'larını güncelle.
- **Build başarısız: NDK / cargo:** Tauri NDK sürümünü bekliyor. `release-android.yml`'da `ndk-version: r27c`; gerekirse `r26b` veya `r28` denenir.
- **APK yüklendi ama imzasız:** `key.properties` workflow tarafından yazılamamış. "Write key.properties" adımının log'una bak.
- **Release oluşturuldu ama APK yok:** "Build Android APK" adımı başarısız ama "Ensure release exists" yine de release oluşturmuş olabilir. APK build log'una bak.
