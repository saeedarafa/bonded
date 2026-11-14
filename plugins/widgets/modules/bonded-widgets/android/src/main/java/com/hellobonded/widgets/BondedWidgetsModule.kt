package com.hellobonded.widgets

import android.content.Context
import android.content.Intent
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
 */
class BondedWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BondedWidgets")

    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
      context.sendBroadcast(Intent(ACTION_REFRESH).setPackage(context.packageName))
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
    const val PREFS = "bonded_widgets"
    const val KEY = "snapshot"
    const val ACTIONS_KEY = "actions"
    private val LOCK = Any()
    const val ACTION_REFRESH = "com.hellobonded.widgets.REFRESH"
  }
}
