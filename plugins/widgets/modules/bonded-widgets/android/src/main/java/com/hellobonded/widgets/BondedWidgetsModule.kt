package com.hellobonded.widgets

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import java.io.File
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * MOB-30: the app's side of the widgets. Writes the snapshot (src/features/widgets/snapshot.ts)
 * to the shared preferences the widget providers read, then broadcasts REFRESH to this app only.
 * Keep the names in step with plugins/widgets/android/kotlin/BondedWidgets.kt.
 *
 * MOB-77: `takeActionQueue()` returns the `{widget_kind, action}` entries the premium widget
 * receivers queued (same prefs, key `actions`, a JSON array) and removes them. No keychain group
 * on Android: the widget token lives in expo-secure-store's Keystore-encrypted prefs.
 *
 * MOB-78 (SEC L1): `hasTokenReader` is true exactly when the plugin built the premium receivers
 * (`premium: true` adds the application meta-data `com.hellobonded.widgets.TOKEN_READER`), which
 * read the token (plugins/widgets/android/premium). The SecureStore prefs are excluded
 * from backup by the expo-secure-store plugin in app.config.ts. Without it the app never mints.
 *
 * MOB-89 (#479): React Native's NetworkingModule builds its OkHttp client with
 * `OkHttpClientProvider.createClient(context)`, which has a 10 MB disk cache in
 * `cacheDir/http-cache`. The JS side sends `Cache-Control: no-store` on every Supabase request
 * (src/lib/httpCache.ts), which OkHttp never stores; `clearHttpCache()` (sign-out, account
 * deletion) deletes whatever an older build left there. A missing entry is a cache miss for
 * OkHttp's DiskLruCache. Nothing here logs.
 */
class BondedWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BondedWidgets")

    Constant("hasTokenReader") {
      appContext.reactContext?.let { hasTokenReader(it) } ?: false
    }

    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
      context.sendBroadcast(Intent(ACTION_REFRESH).setPackage(context.packageName))
    }

    Function("clearHttpCache") {
      appContext.reactContext?.let { clearHttpCacheDir(File(it.cacheDir, HTTP_CACHE_DIR)) }
      Unit
    }

    Function("takeActionQueue") {
      val prefs = appContext.reactContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      synchronized(LOCK) {
        val json: String? = prefs?.getString(ACTIONS_KEY, null)
        if (json != null) prefs?.edit()?.remove(ACTIONS_KEY)?.commit()
        json
      }
    }
  }

  companion object {
    /** Same name as OkHttpClientProvider.createClientBuilder(context, cacheSize). */
    const val HTTP_CACHE_DIR = "http-cache"

    fun clearHttpCacheDir(dir: File) {
      try {
        dir.listFiles()?.forEach { it.deleteRecursively() }
      } catch (e: Exception) {
        // Nothing to do: new responses are never stored (no-store request header).
      }
    }

    /** Same name as plugins/widgets/index.js ANDROID_TOKEN_READER_META. */
    const val TOKEN_READER_META = "com.hellobonded.widgets.TOKEN_READER"

    fun hasTokenReader(context: Context): Boolean =
      try {
        @Suppress("DEPRECATION")
        val info = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        info.metaData?.getBoolean(TOKEN_READER_META, false) == true
      } catch (e: Exception) {
        false
      }

    const val PREFS = "bonded_widgets"
    const val KEY = "snapshot"
    const val ACTIONS_KEY = "actions"
    private val LOCK = Any()
    const val ACTION_REFRESH = "com.hellobonded.widgets.REFRESH"
  }
}
