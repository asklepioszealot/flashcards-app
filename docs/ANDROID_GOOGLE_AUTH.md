# Android Native Google Sign-In Kurulumu

Bu doküman, Flashcards App'in Android sürümünde **native Google girişi** çalıştırmak için yapılması gerekenleri anlatır. Web tarafında zaten Supabase OAuth akışı çalışıyor; Android'de WebView popup açamadığımız için **Android Credential Manager API + Supabase `signInWithIdToken`** kullanacağız.

> **Hedef akış:**
> 1. Kullanıcı "Google ile Giriş" butonuna basar
> 2. Android Credential Manager Google hesap seçici sheet'i açar
> 3. Kullanıcı hesabını seçer → Android bir **ID Token** üretir
> 4. App ID Token'ı Supabase'e `signInWithIdToken({ provider: 'google', token })` ile gönderir
> 5. Supabase JWT döner → kullanıcı oturum açılmış olur

## Yapı

İki taraf var. Sırayla:

- **Bölüm A — Sen yapacaksın (Google Cloud + Supabase):** OAuth client ID'leri oluştur, Supabase'de Google provider'ı enable et. Yaklaşık 15-20 dakika.
- **Bölüm B — Ben yazacağım (kod):** Tauri 2 plugin (Rust komutu + Kotlin Credential Manager wrapper), JS tarafı `signInWithGoogleNative()`, login UI'a buton. Sen test edersin.

---

## Bölüm A — Google Cloud + Supabase kurulumu

### A.1 Debug keystore'dan SHA-1 fingerprint al

> **Neden:** Google Cloud, Android client ID'sini SHA-1 fingerprint'e bağlar. Faz 0'da `tauri android init` çalıştırdığında bir debug keystore otomatik oluşturuldu — onu bulup parmak izini almamız lazım.

PowerShell aç ve şunu çalıştır:

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
```

Çıktıda `SHA1:` satırını bul, şuna benzer:

```
SHA1: AB:CD:EF:12:34:56:78:9A:BC:DE:F1:23:45:67:89:AB:CD:EF:12:34
```

Bu satırı kopyala, A.3'te kullanacaksın.

### A.2 Google Cloud Console'da proje aç (yoksa)

1. https://console.cloud.google.com aç, Google hesabınla giriş yap.
2. Üst menüde proje seçici → "**New Project**".
3. Proje adı: `flashcards-app` (veya istediğin), **Create**.
4. Yeni proje seçili olsun.

> Daha önce Supabase için bir Cloud projesi açtıysan onu kullan, tekrar oluşturma.

### A.3 Android OAuth client ID oluştur

1. Sol menü → **APIs & Services** → **Credentials**.
2. Üstte **+ CREATE CREDENTIALS** → **OAuth client ID**.
3. Eğer "Configure consent screen" istiyorsa önce o ekrana yönlendirilirsin:
   - **User Type:** External
   - **App name:** Flashcards App
   - **User support email:** kendi mailin
   - **Developer contact:** kendi mailin
   - Diğer alanları boş bırakabilirsin, **Save and Continue** → **Save and Continue** → **Back to Dashboard**.
4. Tekrar **Credentials** → **+ CREATE CREDENTIALS** → **OAuth client ID**.
5. **Application type:** `Android`
6. **Name:** `Flashcards Android (debug)`
7. **Package name:** `com.asklepioszealot.flashcards`
8. **SHA-1 certificate fingerprint:** A.1'de aldığın değeri yapıştır.
9. **CREATE**.
10. Açılan diyalogda **Client ID** görünür: `xxxxxxxx-yyyy.apps.googleusercontent.com` — bunu bir yere kopyala, **ANDROID_CLIENT_ID** olarak saklayalım.

### A.4 Web OAuth client ID oluştur (Supabase için)

> **Neden:** Supabase Google provider'ı kendi tarafında bir Web client ID + secret istiyor. Android tarafı ID token üretirken bu Web client ID'sine `audience` olarak gönderecek, böylece Supabase token'ı doğrulayabilecek.

1. Aynı sayfada **+ CREATE CREDENTIALS** → **OAuth client ID**.
2. **Application type:** `Web application`
3. **Name:** `Flashcards Web (Supabase)`
4. **Authorized redirect URIs** → **+ ADD URI**:
   - Supabase Dashboard → Project Settings → API → "Project URL" değerini kopyala, sonuna `/auth/v1/callback` ekle, örn:
     - `https://abcdefg.supabase.co/auth/v1/callback`
5. **CREATE**.
6. Açılan diyalogda hem **Client ID** hem **Client secret** görünür. İkisini de bir yere kopyala:
   - **WEB_CLIENT_ID** (Supabase için + Android tarafında audience olarak da kullanılır)
   - **WEB_CLIENT_SECRET** (Supabase için)

### A.5 Supabase Google provider enable

1. https://supabase.com/dashboard → projeni aç.
2. Sol menü → **Authentication** → **Providers**.
3. **Google** satırını bul, "Enable" toggle.
4. Aşağıdaki alanları doldur:
   - **Client ID (for OAuth):** A.4'teki **WEB_CLIENT_ID**
   - **Client Secret:** A.4'teki **WEB_CLIENT_SECRET**
   - **Authorized Client IDs:** A.3'teki **ANDROID_CLIENT_ID** (virgülle ayırarak birden fazla ekleyebilirsin; **WEB_CLIENT_ID**'i de buraya eklemek zorunlu değil ama önerilir)
5. **Save**.

### A.6 Kimlik bilgilerini repo'ya yaz

Repo kökünde `.env` veya `src/generated/runtime-config.js` üzerinden runtime config geliyor. Web client ID'sini Android plugin tarafında kullanacağız.

Bana iki değeri ver, kod tarafına ben yazarım:

- **ANDROID_CLIENT_ID:** A.3'ten
- **WEB_CLIENT_ID:** A.4'ten (Android plugin'in audience parametresi olarak kullanacağı)

---

## Bölüm B — Kod tarafı (planlanan adımlar)

Aşağıdaki adımları ben yapacağım, commit'ler ile parça parça gelecek. Sadece referans için listeliyorum:

1. **Cargo.toml** — Android-only dependency block'una `jni`, `tauri-plugin-shell` (intent için) ekle.
2. **`src-tauri/src/google_auth.rs`** — Yeni Rust modülü:
   - `#[tauri::command] async fn sign_in_with_google(web_client_id: String) -> Result<String, String>` — ID Token döner.
   - Android'de JNI ile `GoogleAuthPlugin.kt`'i çağırır.
   - Desktop'ta `Err("desktop'ta desteklenmiyor")` döner.
3. **`src-tauri/gen/android/app/src/main/java/.../GoogleAuthPlugin.kt`** — Kotlin sınıfı:
   - `androidx.credentials:credentials` ve `com.google.android.libraries.identity.googleid:googleid` bağımlılıklarını `build.gradle.kts`'e ekle.
   - `CredentialManager.getCredential()` çağrısı, `GetGoogleIdOption` ile ID token iste.
   - Sonucu Rust'a string olarak döndür.
4. **`build.gradle.kts`** — Yukarıdaki iki Android bağımlılığını ekle.
5. **`capabilities/mobile.json`** — Yeni `google_auth:default` permission tanımı.
6. **`src/core/platform-adapter.js`** — `signInWithGoogle()` metodunu Android'de native plugin'i çağıracak, sonra Supabase `client.auth.signInWithIdToken({ provider: 'google', token })` çağıracak şekilde güncelle.
7. **`index.html`** + bootstrap — Login ekranına "Google ile Giriş" butonu. `isAndroidRuntime()` true ise göster, değilse mevcut web OAuth akışına düş.
8. **`runtime-config.js`** — `googleWebClientId` config alanı ekle.

Tahmini ek commit sayısı: 5–7.

---

## Test sırası

A bölümü bitince:
1. APK rebuild (`npm run tauri android dev`).
2. App login ekranı → "Google ile Giriş" butonu görünmeli.
3. Tap → Android Credential Manager sheet açılmalı.
4. Hesap seç → app girişi tamamlanmalı, Set Manager açılmalı.

Hata çıkarsa logcat çıktısını al:
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" logcat -s TauriPlugin GoogleAuthPlugin
```
