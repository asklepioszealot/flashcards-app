package com.asklepioszealot.flashcards

import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // WebView forwards system bar / display cutout insets to CSS env(safe-area-inset-*)
    // only from M144 on; older WebViews let content slide under the status bar. Apply the
    // insets as native padding and pass zeroed insets to the WebView (no double padding).
    // See developer.android.com "Understand window insets in WebView".
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, windowInsets ->
      val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      val insets = windowInsets.getInsets(types)
      view.setPadding(insets.left, insets.top, insets.right, insets.bottom)
      WindowInsetsCompat.Builder(windowInsets).setInsets(types, Insets.NONE).build()
    }
  }
}
