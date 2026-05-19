package com.asklepioszealot.flashcards

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@InvokeArg
class SignInArgs {
  lateinit var webClientId: String
}

/**
 * Bridges the Rust `sign_in_with_google` command into Android's Credential
 * Manager. Returns the Google ID token (plus the email associated with the
 * chosen account) so the JS layer can hand the token to Supabase
 * `auth.signInWithIdToken({ provider: 'google', token })`.
 */
@TauriPlugin
class GoogleAuthPlugin(private val activity: Activity) : Plugin(activity) {

  @Command
  fun signIn(invoke: Invoke) {
    val args = invoke.parseArgs(SignInArgs::class.java)
    val webClientId = args.webClientId

    if (webClientId.isBlank()) {
      invoke.reject("webClientId boş olamaz.")
      return
    }

    val credentialManager = CredentialManager.create(activity)
    val googleIdOption = GetGoogleIdOption.Builder()
      // Allow any Google account on the device, not just previously authorized ones.
      .setFilterByAuthorizedAccounts(false)
      .setServerClientId(webClientId)
      .setAutoSelectEnabled(false)
      .build()

    val request = GetCredentialRequest.Builder()
      .addCredentialOption(googleIdOption)
      .build()

    CoroutineScope(Dispatchers.Main).launch {
      try {
        val result = credentialManager.getCredential(activity, request)
        val credential = result.credential

        if (credential !is CustomCredential ||
          credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
          invoke.reject("Beklenmeyen kimlik bilgisi türü: ${credential.type}")
          return@launch
        }

        try {
          val googleCredential = GoogleIdTokenCredential.createFrom(credential.data)
          val response = JSObject()
          response.put("idToken", googleCredential.idToken)
          response.put("email", googleCredential.id)
          invoke.resolve(response)
        } catch (parseError: GoogleIdTokenParsingException) {
          invoke.reject("ID token ayrıştırılamadı: ${parseError.message}")
        }
      } catch (credentialError: GetCredentialException) {
        invoke.reject("Credential Manager hatası: ${credentialError.message ?: credentialError.javaClass.simpleName}")
      } catch (unexpected: Exception) {
        invoke.reject("Beklenmeyen hata: ${unexpected.message ?: unexpected.javaClass.simpleName}")
      }
    }
  }
}
