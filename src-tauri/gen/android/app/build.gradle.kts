import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Release signing config — values live in src-tauri/gen/android/key.properties
// (gitignored). When the file is absent or has empty passwords, release builds
// fall back to the unsigned/debug-signed output so a fresh clone still builds.
val keyProperties = Properties().apply {
    val keyPropFile = file("../key.properties")
    if (keyPropFile.exists()) {
        keyPropFile.inputStream().use { load(it) }
    }
}
val keystoreAvailable = run {
    val storeFilePath = keyProperties.getProperty("storeFile").orEmpty()
    val storePassword = keyProperties.getProperty("storePassword").orEmpty()
    val keyAlias = keyProperties.getProperty("keyAlias").orEmpty()
    val keyPassword = keyProperties.getProperty("keyPassword").orEmpty()
    storeFilePath.isNotBlank()
        && storePassword.isNotBlank()
        && storePassword != "FILL_IN_YOUR_PASSWORD"
        && keyAlias.isNotBlank()
        && keyPassword.isNotBlank()
        && keyPassword != "FILL_IN_YOUR_PASSWORD"
        && file(storeFilePath).exists()
}

android {
    compileSdk = 36
    namespace = "com.asklepioszealot.flashcards"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.asklepioszealot.flashcards"
        minSdk = 28
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    if (keystoreAvailable) {
        signingConfigs {
            create("release") {
                storeFile = file(keyProperties.getProperty("storeFile"))
                storePassword = keyProperties.getProperty("storePassword")
                keyAlias = keyProperties.getProperty("keyAlias")
                keyPassword = keyProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
            if (keystoreAvailable) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    // Native Google sign-in (Faz 3): Credential Manager + Google Identity.
    implementation("androidx.credentials:credentials:1.3.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")