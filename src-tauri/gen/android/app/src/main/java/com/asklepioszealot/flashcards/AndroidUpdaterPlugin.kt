package com.asklepioszealot.flashcards

import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class DownloadAndInstallArgs {
  lateinit var url: String
  lateinit var version: String
}

/**
 * Bridges the Rust `download_and_install_apk` command into Android's
 * DownloadManager + package-installer pipeline:
 *
 *   1. Enqueue a DownloadManager request for the APK URL, saving it into
 *      the app-private external "updates/" directory.
 *   2. Listen for ACTION_DOWNLOAD_COMPLETE.
 *   3. Wrap the file in a FileProvider content:// URI and fire an
 *      ACTION_VIEW intent with the package-archive MIME so the system
 *      installer prompts the user to apply the update.
 *
 * Resolves once the installer activity has been launched; the actual
 * install happens out-of-process and the app will be killed and relaunched
 * by the package manager.
 */
@TauriPlugin
class AndroidUpdaterPlugin(private val activity: Activity) : Plugin(activity) {

  @Command
  fun downloadAndInstall(invoke: Invoke) {
    val args = invoke.parseArgs(DownloadAndInstallArgs::class.java)
    val url = args.url
    val version = args.version

    if (url.isBlank()) {
      invoke.reject("APK URL boş olamaz.")
      return
    }
    if (version.isBlank()) {
      invoke.reject("Sürüm bilgisi boş olamaz.")
      return
    }

    val fileName = "flashcards-${version}.apk"
    val updatesDir = File(activity.getExternalFilesDir(null), "updates").apply { mkdirs() }
    val targetFile = File(updatesDir, fileName)
    if (targetFile.exists()) targetFile.delete()

    val downloadManager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    val request = DownloadManager.Request(Uri.parse(url))
      .setTitle("Flashcards App güncellemesi")
      .setDescription("Sürüm $version indiriliyor")
      .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
      .setDestinationUri(Uri.fromFile(targetFile))
      .setAllowedOverMetered(true)
      .setAllowedOverRoaming(true)

    val downloadId = downloadManager.enqueue(request)

    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
        if (id != downloadId) return
        try { context.unregisterReceiver(this) } catch (_: Exception) {}

        if (!targetFile.exists() || targetFile.length() == 0L) {
          invoke.reject("APK indirilemedi veya boş geldi.")
          return
        }

        try {
          val authority = "${context.packageName}.fileprovider"
          val apkUri = FileProvider.getUriForFile(context, authority, targetFile)
          val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
          context.startActivity(installIntent)

          val response = JSObject()
          response.put("status", "installer_launched")
          response.put("path", targetFile.absolutePath)
          invoke.resolve(response)
        } catch (e: Exception) {
          invoke.reject("Kurulum ekranı açılamadı: ${e.message ?: e.javaClass.simpleName}")
        }
      }
    }

    val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
    if (android.os.Build.VERSION.SDK_INT >= 33) {
      activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      activity.registerReceiver(receiver, filter)
    }
  }
}
