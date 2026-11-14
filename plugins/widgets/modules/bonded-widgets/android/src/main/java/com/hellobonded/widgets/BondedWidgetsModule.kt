package com.hellobonded.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProviderInfo
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
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
 * MOB-78c (QA-49b): `reloadWidgets()` sends an explicit APPWIDGET_UPDATE (with that provider's ids)
 * to each of this app's widget providers that has a widget on the home screen. `onUpdate` redraws
 * the free widgets from the snapshot, and the Premium Little things widget fetches `state` again
 * (a lapse then shows the locked preview, a 401 clears its cache). Explicit intents only, nothing
 * logged; a failure is swallowed (a widget must not break the app).
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

    Function("reloadWidgets") {
      val context = appContext.reactContext ?: return@Function
      reloadAll(context)
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
    fun reloadAll(context: Context) {
      try {
        val manager = AppWidgetManager.getInstance(context) ?: return
        val providers: List<AppWidgetProviderInfo> =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.getInstalledProvidersForPackage(context.packageName, null)
          } else {
            manager.installedProviders.filter { it.provider.packageName == context.packageName }
          }
        for (info in providers) {
          val ids = manager.getAppWidgetIds(info.provider)
          if (ids.isEmpty()) continue
          val intent = Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
            .setComponent(info.provider)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
          context.sendBroadcast(intent)
        }
      } catch (e: Exception) {
        // Never log, never throw.
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
