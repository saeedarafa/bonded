package __PACKAGE__.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import __PACKAGE__.R
import java.text.NumberFormat
import org.json.JSONObject

// MOB-78e Days together widget for Android (screen 38c-3, D59, SEC-21 option A). Compiled only with
// the plugin's `premium: true`, next to BondedLittleThings.kt, whose WidgetTokenStore (read-only),
// WidgetClient (the one network path), WidgetResponse, WidgetActionQueue and LittleThingsWidgets.runAsync
// it reuses. Not yet built with Gradle or run on a device (plugins/widgets/README.md).
//
// - Read-only: the only call is `state`. No taps send anything; the whole widget opens the app.
// - What it keeps (DaysCache, prefs `bonded_widget_days_together`): numbers from the allow-listed
//   `state` fields (days_together, days_in_bonded, the next two key dates' kind/days_until/years/
//   whose) and the partner's first name for "Sam's birthday". Never the token, never answer, message,
//   voice or question text. Locked (free/lapsed) or 401 clears it.
// - Free or lapsed couple (200 premium:false or 403): locked preview, tap → paywall from=widget.
// - 401 WIDGET_AUTH or no token: "Open Bonded" with no data.

/** One `next_key_dates` entry: kind, days until it, years, whose (never a title or a date). */
class KeyDate(val kind: String, val daysUntil: Int, val years: Int?, val whose: String?)

/** The allow-listed numbers the widget draws, from `state` (CONTRACTS §3 `widget`). */
class DaysCache(
  val daysTogether: Int?,
  val daysInBonded: Int?,
  /** The next key dates, at most two (the 4 x 2 layout shows both, the others the first). */
  val next: List<KeyDate>,
  val partnerFirstName: String?,
) {
  companion object {
    const val PREFS = "bonded_widget_days_together"
    private const val VIEW_KEY = "view"
    private val KEY_KINDS = setOf("together_since", "anniversary", "birthday")
    private val WHOSE = setOf("me", "partner")
    private const val NAME_MAX = 20
    /** Pref key prefixes of the first and second next key date. */
    private val PREFIXES = listOf("next", "next2")

    private fun intOrNull(o: JSONObject?, key: String): Int? =
      if (o == null || !o.has(key) || o.isNull(key)) null else o.optInt(key).takeIf { it >= 0 }

    private fun keyDate(o: JSONObject?): KeyDate? {
      val kind = o?.optString("kind")?.takeIf { it in KEY_KINDS } ?: return null
      val days = intOrNull(o, "days_until") ?: return null
      return KeyDate(kind, days, intOrNull(o, "years"), o.optString("whose").takeIf { it in WHOSE })
    }

    fun fromState(body: JSONObject): DaysCache {
      val dates = body.optJSONArray("next_key_dates")
      val name = if (body.isNull("partner_first_name")) null
      else body.optString("partner_first_name").trim().take(NAME_MAX).takeIf { it.isNotEmpty() }
      return DaysCache(
        daysTogether = intOrNull(body, "days_together"),
        daysInBonded = intOrNull(body, "days_in_bonded"),
        next = listOfNotNull(keyDate(dates?.optJSONObject(0)), keyDate(dates?.optJSONObject(1))),
        partnerFirstName = name,
      )
    }

    fun load(context: Context): DaysCache {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      fun int(key: String): Int? = if (p.contains(key)) p.getInt(key, 0) else null
      fun date(prefix: String): KeyDate? {
        val kind = p.getString("${prefix}_kind", null)?.takeIf { it in KEY_KINDS } ?: return null
        val days = int("${prefix}_days_until") ?: return null
        return KeyDate(kind, days, int("${prefix}_years"), p.getString("${prefix}_whose", null)?.takeIf { it in WHOSE })
      }
      return DaysCache(
        daysTogether = int("days_together"),
        daysInBonded = int("days_in_bonded"),
        next = listOfNotNull(date(PREFIXES[0]), date(PREFIXES[1])),
        partnerFirstName = p.getString("partner_first_name", null),
      )
    }

    fun save(context: Context, value: DaysCache) {
      val e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear()
      value.daysTogether?.let { e.putInt("days_together", it) }
      value.daysInBonded?.let { e.putInt("days_in_bonded", it) }
      for ((i, d) in value.next.take(PREFIXES.size).withIndex()) {
        val prefix = PREFIXES[i]
        e.putString("${prefix}_kind", d.kind)
        e.putInt("${prefix}_days_until", d.daysUntil)
        d.years?.let { e.putInt("${prefix}_years", it) }
        d.whose?.let { e.putString("${prefix}_whose", it) }
      }
      value.partnerFirstName?.let { e.putString("partner_first_name", it) }
      e.putString(VIEW_KEY, "ready").commit()
    }

    /** Drops every field and remembers only which view to draw next (locked / expired). */
    fun clear(context: Context, view: String) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear()
        .putString(VIEW_KEY, view).commit()
    }

    fun lastViewName(context: Context): String? =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(VIEW_KEY, null)
  }
}

/**
 * #495: a launcher reports a one-row widget at up to ~100 dp (QA-49f: three lines fit, the 48 dp
 * button did not), two rows at 140 dp or more. Under this height the widget is the 4 x 1 bar.
 */
const val BAR_MAX_HEIGHT_DP = 120

/** 2 x 2 small, 4 x 2 medium (two key dates), 4 x 1 one-line bar (38c-11). */
enum class DaysSize { SMALL, MEDIUM, BAR }

sealed class DaysView {
  class Ready(val cache: DaysCache) : DaysView()
  object Locked : DaysView()
  object Expired : DaysView()
}

private const val DAYS_PAYWALL_URL = "bonded://paywall?from=widget&widget_kind=days_together"
// #497: Us has no key-dates screen yet (D50 (7)); Couple settings (`/us/couple`) has no key dates
// either. The tap opens the Us tab; "Add dates" opens 47 (`/quiz/dates`), which writes the dates for
// a paired couple. Spec 38c §3.3 says "Us tab, key dates": change both once Us has that screen.
private const val DAYS_OPEN_URL = "bonded://us"
private const val DAYS_ADD_DATES_URL = "bonded://quiz/dates"
private const val DAYS_EXPIRED_URL = "bonded://today"
private const val DAYS_LOCKED_SEEN_KEY = "lockedSeen"

object DaysTogetherWidgets {
  const val REQUEST_OPEN = 7_810
  const val REQUEST_PAYWALL = 7_811
  const val REQUEST_EXPIRED = 7_812
  const val REQUEST_ADD_DATES = 7_813

  fun ids(context: Context): IntArray =
    AppWidgetManager.getInstance(context)
      .getAppWidgetIds(ComponentName(context, BondedDaysTogetherWidget::class.java))

  /** Fetches `state` (background thread only), stores the allow-listed numbers, then redraws. */
  fun refresh(context: Context) {
    val view = when (val response = WidgetClient.state(context)) {
      is WidgetResponse.Ok -> {
        val cache = DaysCache.fromState(response.body)
        DaysCache.save(context, cache)
        DaysView.Ready(cache)
      }
      is WidgetResponse.Locked -> {
        DaysCache.clear(context, "locked")
        DaysView.Locked
      }
      is WidgetResponse.Expired -> {
        DaysCache.clear(context, "expired")
        DaysView.Expired
      }
      // Offline, 429, 5xx: keep what was drawn (display only; the next refresh corrects it).
      else -> lastView(context)
    }
    noteLocked(context, view is DaysView.Locked)
    redraw(context, view)
  }

  /** `view_locked` once per locked spell, not on every refresh. */
  private fun noteLocked(context: Context, locked: Boolean) {
    val prefs = context.getSharedPreferences(DaysCache.PREFS + "_seen", Context.MODE_PRIVATE)
    val seen = prefs.getBoolean(DAYS_LOCKED_SEEN_KEY, false)
    if (locked && !seen) WidgetActionQueue.record(context, "days_together", "view_locked")
    prefs.edit().putBoolean(DAYS_LOCKED_SEEN_KEY, locked).commit()
  }

  fun lastView(context: Context): DaysView = when (DaysCache.lastViewName(context)) {
    "ready" -> DaysView.Ready(DaysCache.load(context))
    "locked" -> DaysView.Locked
    else -> DaysView.Expired
  }

  fun redraw(context: Context, view: DaysView) {
    val manager = AppWidgetManager.getInstance(context)
    for (id in ids(context)) {
      manager.updateAppWidget(id, render(context, view, manager.getAppWidgetOptions(id)))
    }
  }

  private fun open(context: Context, url: String, requestCode: Int): PendingIntent {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun plural(key: String, n: Int, args: Map<String, String> = emptyMap()): String =
    BondedPremiumCopy.t(
      if (n == 1) "${key}_one" else "${key}_other",
      args + ("count" to NumberFormat.getIntegerInstance().format(n)),
    )

  /** A key date line, or null. On a keyguard host the partner's name is never drawn. */
  private fun nextLine(cache: DaysCache, date: KeyDate?, hideName: Boolean): String? {
    val n = date?.daysUntil ?: return null
    return when (date.kind) {
      "anniversary", "together_since" ->
        if (n == 0) date.years?.let { plural("days.anniversaryToday", it) }
        else plural("days.next.anniversary", n)
      "birthday" -> when {
        date.whose == "me" -> plural("days.next.birthdayMe", n)
        date.whose == "partner" && !hideName && cache.partnerFirstName != null -> {
          val name = cache.partnerFirstName.replaceFirstChar { it.uppercaseChar() }
          plural("days.next.birthdayPartner", n, mapOf("partner, capitalize" to name))
        }
        else -> null
      }
      else -> null
    }
  }

  /** Portrait size: width = min width, height = max height (AppWidgetManager docs). */
  fun size(options: Bundle?): DaysSize {
    val width = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 0
    val height = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) ?: 0
    return when {
      height in 1 until BAR_MAX_HEIGHT_DP -> DaysSize.BAR
      width >= 250 -> DaysSize.MEDIUM
      else -> DaysSize.SMALL
    }
  }

  private fun line(views: RemoteViews, id: Int, text: String?) {
    views.setViewVisibility(id, if (text.isNullOrEmpty()) View.GONE else View.VISIBLE)
    views.setTextViewText(id, text ?: "")
  }

  /** The button; the 4 x 1 bar has no room for it (the whole widget is the tap target there). */
  private fun cta(views: RemoteViews, text: String, size: DaysSize) {
    if (size == DaysSize.BAR) return
    views.setViewVisibility(R.id.bonded_cta, View.VISIBLE)
    views.setTextViewText(R.id.bonded_cta, text)
  }

  fun render(context: Context, view: DaysView, options: Bundle?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.bonded_widget_days_together)
    val size = size(options)
    val bar = size == DaysSize.BAR
    views.setTextViewText(R.id.bonded_title, BondedPremiumCopy.t("days.name"))
    views.setViewVisibility(R.id.bonded_lock, View.GONE)
    views.setViewVisibility(R.id.bonded_count, View.GONE)
    views.setViewVisibility(R.id.bonded_cta, View.GONE)
    line(views, R.id.bonded_line, null)
    line(views, R.id.bonded_line2, null)
    // The 4 x 1 bar: no title row, tighter padding.
    views.setViewVisibility(R.id.bonded_header, if (bar) View.GONE else View.VISIBLE)
    val pad = ((if (bar) 8 else 14) * context.resources.displayMetrics.density).toInt()
    views.setViewPadding(R.id.bonded_root, pad, pad, pad, pad)
    when (view) {
      is DaysView.Ready -> {
        val cache = view.cache
        val hideName = LittleThingsWidgets.onKeyguard(options)
        val together = cache.daysTogether
        if (together != null) {
          views.setViewVisibility(R.id.bonded_count, View.VISIBLE)
          views.setTextViewText(R.id.bonded_count, plural("days.count", together))
          line(views, R.id.bonded_line, nextLine(cache, cache.next.getOrNull(0), hideName))
          // 4 x 2 shows the next two key dates (38c-3 medium).
          if (size == DaysSize.MEDIUM) {
            line(views, R.id.bonded_line2, nextLine(cache, cache.next.getOrNull(1), hideName))
          }
        } else {
          // No key dates: count from pairing + "Add dates" (opens key dates).
          cache.daysInBonded?.let {
            views.setViewVisibility(R.id.bonded_count, View.VISIBLE)
            views.setTextViewText(R.id.bonded_count, plural("days.inBonded", it))
          }
          // The bar has no button, so it says "Add dates" as its line instead.
          if (bar) line(views, R.id.bonded_line, BondedPremiumCopy.t("days.addDates"))
          cta(views, BondedPremiumCopy.t("days.addDates"), size)
        }
        views.setOnClickPendingIntent(
          R.id.bonded_root,
          if (together != null) open(context, DAYS_OPEN_URL, REQUEST_OPEN)
          else open(context, DAYS_ADD_DATES_URL, REQUEST_ADD_DATES),
        )
      }
      is DaysView.Locked -> {
        views.setViewVisibility(R.id.bonded_header, View.VISIBLE)
        views.setViewVisibility(R.id.bonded_lock, View.VISIBLE)
        line(views, R.id.bonded_line, BondedPremiumCopy.t("locked.premium"))
        cta(views, BondedPremiumCopy.t("locked.cta"), size)
        views.setOnClickPendingIntent(R.id.bonded_root, open(context, DAYS_PAYWALL_URL, REQUEST_PAYWALL))
      }
      is DaysView.Expired -> {
        views.setViewVisibility(R.id.bonded_header, View.VISIBLE)
        views.setTextViewText(R.id.bonded_title, BondedPremiumCopy.t("expired"))
        line(views, R.id.bonded_line, if (bar) BondedPremiumCopy.t("open") else null)
        cta(views, BondedPremiumCopy.t("open"), size)
        views.setOnClickPendingIntent(R.id.bonded_root, open(context, DAYS_EXPIRED_URL, REQUEST_EXPIRED))
      }
    }
    return views
  }
}

/** 38c-3 Days together (Home Screen; 2 x 2, 4 x 2, 4 x 1). Read-only. */
class BondedDaysTogetherWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    // Draw what we had at once, then refresh from the server off the main thread.
    val last = DaysTogetherWidgets.lastView(context)
    for (id in ids) {
      manager.updateAppWidget(id, DaysTogetherWidgets.render(context, last, manager.getAppWidgetOptions(id)))
    }
    LittleThingsWidgets.runAsync(this) { DaysTogetherWidgets.refresh(context) }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    id: Int,
    options: Bundle?,
  ) {
    manager.updateAppWidget(id, DaysTogetherWidgets.render(context, DaysTogetherWidgets.lastView(context), options))
  }

  /**
   * REFRESH comes from the app on every snapshot write (sign-out writes the empty one). No network
   * here: only drop to "Open Bonded" when the token is gone, so a signed-out phone shows no data.
   */
  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action != BONDED_WIDGET_REFRESH) return
    LittleThingsWidgets.runAsync(this) {
      if (WidgetTokenStore.read(context) == null) {
        DaysCache.clear(context, "expired")
        DaysTogetherWidgets.redraw(context, DaysView.Expired)
      }
    }
  }

  override fun onDisabled(context: Context) {
    DaysCache.clear(context, "expired")
  }
}
