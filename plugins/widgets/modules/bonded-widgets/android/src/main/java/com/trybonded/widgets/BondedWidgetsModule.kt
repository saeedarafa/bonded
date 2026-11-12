package com.trybonded.widgets

import android.content.Context
import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * MOB-30: the app's side of the widgets. Writes the snapshot (src/features/widgets/snapshot.ts)
 * to the shared preferences the widget providers read, then broadcasts REFRESH to this app only.
 * Keep the names in step with plugins/widgets/android/kotlin/BondedWidgets.kt.
 */
class BondedWidgetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BondedWidgets")

    Function("setSnapshot") { json: String ->
      val context = appContext.reactContext ?: return@Function
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
      context.sendBroadcast(Intent(ACTION_REFRESH).setPackage(context.packageName))
    }
  }

  companion object {
    const val PREFS = "bonded_widgets"
    const val KEY = "snapshot"
    const val ACTION_REFRESH = "com.trybonded.widgets.REFRESH"
  }
}
