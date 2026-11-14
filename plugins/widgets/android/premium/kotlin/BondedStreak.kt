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

// MOB-78f Streak widget for Android (screen 38c-4, D59, SEC-21 option A). Compiled only with the
// plugin's `premium: true`, next to BondedLittleThings.kt, whose WidgetTokenStore (read-only),
// WidgetClient (the one network path), WidgetResponse, WidgetActionQueue and LittleThingsWidgets
// (runAsync, onKeyguard) it reuses. Not yet built with Gradle or run on a device
// (plugins/widgets/README.md).
//
// - Read-only: the only call is `state`. The widget never spends a streak saver: "Use saver" opens
//   Today, where the app's saver card is (the same `use_streak_saver` path as in the app).
// - What it keeps (StreakCache, prefs `bonded_widget_streak`): the allow-listed `state` numbers
//   (streak.current, streak.next_badge.threshold), streak.saver_available and whether the mascot
//   naps. Never the token, never answer, message, voice or question text, never a name.
//   Locked (free/lapsed) or 401 clears it.
// - Free or lapsed couple (200 premium:false or 403): locked preview, tap → paywall from=widget.
// - 401 WIDGET_AUTH or no token: "Open Bonded" with no data.

/** The allow-listed values the widget draws, from `state` (CONTRACTS §3 `widget`). */
class StreakCache(
  val current: Int?,
  val nextBadge: Int?,
  val saverAvailable: Boolean,
  val napping: Boolean,
) {
  companion object {
    const val PREFS = "bonded_widget_streak"
    private const val VIEW_KEY = "view"

    private fun intOrNull(o: JSONObject?, key: String): Int? =
      if (o == null || !o.has(key) || o.isNull(key)) null else o.optInt(key).takeIf { it >= 0 }

    fun fromState(body: JSONObject): StreakCache {
      val streak = body.optJSONObject("streak")
      val badge = if (streak == null || streak.isNull("next_badge")) null
      else streak.optJSONObject("next_badge")
      return StreakCache(
        current = intOrNull(streak, "current"),
        nextBadge = intOrNull(badge, "threshold")?.takeIf { it > 0 },
        saverAvailable = streak?.optBoolean("saver_available", false) == true,
        napping = body.optString("mascot") == "napping",
      )
    }

    fun load(context: Context): StreakCache {
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      fun int(key: String): Int? = if (p.contains(key)) p.getInt(key, 0) else null
      return StreakCache(
        current = int("current"),
        nextBadge = int("next_badge"),
        saverAvailable = p.getBoolean("saver_available", false),
        napping = p.getBoolean("napping", false),
      )
    }

    fun save(context: Context, value: StreakCache) {
      val e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear()
      value.current?.let { e.putInt("current", it) }
      value.nextBadge?.let { e.putInt("next_badge", it) }
      e.putBoolean("saver_available", value.saverAvailable)
      e.putBoolean("napping", value.napping)
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

sealed class StreakView {
  class Ready(val cache: StreakCache) : StreakView()
  object Locked : StreakView()
  object Expired : StreakView()
}

/** 2 x 2 small, 4 x 2 medium (with the ladder), 4 x 1 one-line bar (38c-11). */
enum class StreakSize { SMALL, MEDIUM, BAR }

private const val STREAK_PAYWALL_URL = "bonded://paywall?from=widget&widget_kind=streak"
private const val STREAK_BADGES_URL = "bonded://us/badges"
private const val STREAK_TODAY_URL = "bonded://today"
private const val STREAK_LOCKED_SEEN_KEY = "lockedSeen"

object StreakWidgets {
  const val REQUEST_BADGES = 7_820
  const val REQUEST_TODAY = 7_821
  const val REQUEST_PAYWALL = 7_822
  const val REQUEST_EXPIRED = 7_823

  /** The streak badge ladder (spec 38c-4; `badges` rows of kind `streak`). */
  val LADDER = intArrayOf(1, 3, 7, 14, 21, 30, 50, 100, 365)

  private val STEPS = intArrayOf(
    R.id.bonded_step_1, R.id.bonded_step_2, R.id.bonded_step_3,
    R.id.bonded_step_4, R.id.bonded_step_5, R.id.bonded_step_6,
  )

  fun ids(context: Context): IntArray =
    AppWidgetManager.getInstance(context)
      .getAppWidgetIds(ComponentName(context, BondedStreakWidget::class.java))

  /** Fetches `state` (background thread only), stores the allow-listed values, then redraws. */
  fun refresh(context: Context) {
    val view = when (val response = WidgetClient.state(context)) {
      is WidgetResponse.Ok -> {
        val cache = StreakCache.fromState(response.body)
        StreakCache.save(context, cache)
        StreakView.Ready(cache)
      }
      is WidgetResponse.Locked -> {
        StreakCache.clear(context, "locked")
        StreakView.Locked
      }
      is WidgetResponse.Expired -> {
        StreakCache.clear(context, "expired")
        StreakView.Expired
      }
      // Offline, 429, 5xx: keep what was drawn (display only; the next refresh corrects it).
      else -> lastView(context)
    }
    noteLocked(context, view is StreakView.Locked)
    redraw(context, view)
  }

  /** `view_locked` once per locked spell, not on every refresh. */
  private fun noteLocked(context: Context, locked: Boolean) {
    val prefs = context.getSharedPreferences(StreakCache.PREFS + "_seen", Context.MODE_PRIVATE)
    val seen = prefs.getBoolean(STREAK_LOCKED_SEEN_KEY, false)
    if (locked && !seen) WidgetActionQueue.record(context, "streak", "view_locked")
    prefs.edit().putBoolean(STREAK_LOCKED_SEEN_KEY, locked).commit()
  }

  fun lastView(context: Context): StreakView = when (StreakCache.lastViewName(context)) {
    "ready" -> StreakView.Ready(StreakCache.load(context))
    "locked" -> StreakView.Locked
    else -> StreakView.Expired
  }

  fun redraw(context: Context, view: StreakView) {
    val manager = AppWidgetManager.getInstance(context)
    for (id in ids(context)) {
      manager.updateAppWidget(id, render(context, view, manager.getAppWidgetOptions(id)))
    }
  }

  /** Portrait size: width = min width, height = max height (AppWidgetManager docs). */
  fun size(options: Bundle?): StreakSize {
    val width = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 0
    val height = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT) ?: 0
    return when {
      height in 1 until 100 -> StreakSize.BAR
      width >= 250 -> StreakSize.MEDIUM
      else -> StreakSize.SMALL
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

  private fun number(n: Int): String = NumberFormat.getIntegerInstance().format(n)

  private fun plural(key: String, n: Int, args: Map<String, String> = emptyMap()): String =
    BondedPremiumCopy.t(if (n == 1) "${key}_one" else "${key}_other", args + ("count" to number(n)))

  /** "2 days to badge 14", or "Every streak badge earned" past the last step. */
  private fun badgeLine(current: Int, nextBadge: Int?): String =
    if (nextBadge == null || nextBadge <= current) BondedPremiumCopy.t("streak.allBadges")
    else plural("streak.nextBadge", nextBadge - current, mapOf("badge" to number(nextBadge)))

  /** Six ladder steps around the next badge: reached steps filled, the next one dashed. */
  private fun ladder(context: Context, views: RemoteViews, current: Int) {
    val next = LADDER.indexOfFirst { it > current }.let { if (it < 0) LADDER.size else it }
    val start = (next - 3).coerceIn(0, LADDER.size - STEPS.size)
    for ((i, id) in STEPS.withIndex()) {
      val index = start + i
      val step = LADDER[index]
      val (background, color) = when {
        step <= current -> R.drawable.bonded_widget_step_done to R.color.bonded_widget_on_you
        index == next -> R.drawable.bonded_widget_step_next to R.color.bonded_widget_you_text
        else -> R.drawable.bonded_widget_step_todo to R.color.bonded_widget_text3
      }
      views.setTextViewText(id, number(step))
      views.setInt(id, "setBackgroundResource", background)
      views.setTextColor(id, context.getColor(color))
    }
    views.setViewVisibility(R.id.bonded_ladder, View.VISIBLE)
  }

  /** The small layout's bar: current / next badge (the board's 12 of 14 = 86%); full past 365. */
  private fun progress(views: RemoteViews, current: Int, nextBadge: Int?) {
    val percent = if (nextBadge == null || nextBadge <= current) 100 else current * 100 / nextBadge
    views.setViewVisibility(R.id.bonded_progress, View.VISIBLE)
    views.setProgressBar(R.id.bonded_progress, 100, percent, false)
  }

  /** The count as "12 · days, both of you" (small) or "12-day streak" (medium, bar). */
  private fun count(views: RemoteViews, current: Int, size: StreakSize) {
    if (size == StreakSize.SMALL) {
      views.setViewVisibility(R.id.bonded_count_row, View.VISIBLE)
      views.setTextViewText(R.id.bonded_count, number(current))
      views.setTextViewText(
        R.id.bonded_unit,
        BondedPremiumCopy.t(if (current == 1) "streak.days_one" else "streak.days_other"),
      )
    } else {
      headline(views, plural("streak.bar", current))
    }
  }

  private fun headline(views: RemoteViews, text: String) {
    views.setViewVisibility(R.id.bonded_headline, View.VISIBLE)
    views.setTextViewText(R.id.bonded_headline, text)
  }

  /** The button; the 4 x 1 bar has no room for it (the whole widget is the tap target there). */
  private fun cta(views: RemoteViews, text: String, size: StreakSize) {
    if (size == StreakSize.BAR) return
    views.setViewVisibility(R.id.bonded_cta, View.VISIBLE)
    views.setTextViewText(R.id.bonded_cta, text)
  }

  /** The secondary line; gone when empty so the small layout keeps room for the button. */
  private fun line(views: RemoteViews, text: String) {
    views.setViewVisibility(R.id.bonded_line, if (text.isEmpty()) View.GONE else View.VISIBLE)
    views.setTextViewText(R.id.bonded_line, text)
  }

  private fun ready(context: Context, views: RemoteViews, cache: StreakCache, size: StreakSize) {
    val current = cache.current ?: 0
    when {
      // Missed day, saver ready: "Use saver" opens Today's saver card; the widget never spends it.
      cache.saverAvailable -> {
        val ready = BondedPremiumCopy.t("streak.saverReady")
        if (current > 0 && size == StreakSize.SMALL) {
          // Small: "12 · Saver ready" on one row, so the button still fits in 2 x 2.
          count(views, current, size)
          views.setTextViewText(R.id.bonded_unit, ready)
        } else {
          if (current > 0) count(views, current, size) else headline(views, ready)
          if (current > 0) line(views, ready)
        }
        cta(views, BondedPremiumCopy.t("streak.useSaver"), size)
        views.setOnClickPendingIntent(R.id.bonded_root, open(context, STREAK_TODAY_URL, REQUEST_TODAY))
      }
      // Missed day, no saver: napping, never sad.
      current == 0 && cache.napping -> {
        headline(views, BondedPremiumCopy.t("streak.napping"))
        line(views, BondedPremiumCopy.t("streak.missed"))
        views.setOnClickPendingIntent(R.id.bonded_root, open(context, STREAK_TODAY_URL, REQUEST_TODAY))
      }
      // No streak yet.
      current == 0 -> {
        headline(views, BondedPremiumCopy.t("streak.start"))
        line(views, BondedPremiumCopy.t("streak.startSub"))
        views.setOnClickPendingIntent(R.id.bonded_root, open(context, STREAK_TODAY_URL, REQUEST_TODAY))
      }
      else -> {
        count(views, current, size)
        if (size == StreakSize.MEDIUM) ladder(context, views, current)
        if (size == StreakSize.SMALL) progress(views, current, cache.nextBadge)
        line(views, badgeLine(current, cache.nextBadge))
        views.setOnClickPendingIntent(R.id.bonded_root, open(context, STREAK_BADGES_URL, REQUEST_BADGES))
      }
    }
  }

  fun render(context: Context, view: StreakView, options: Bundle?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.bonded_widget_streak)
    val size = size(options)
    views.setTextViewText(R.id.bonded_title, BondedPremiumCopy.t("streak.name"))
    views.setViewVisibility(R.id.bonded_lock, View.GONE)
    views.setViewVisibility(R.id.bonded_count_row, View.GONE)
    views.setViewVisibility(R.id.bonded_headline, View.GONE)
    views.setViewVisibility(R.id.bonded_ladder, View.GONE)
    views.setViewVisibility(R.id.bonded_progress, View.GONE)
    views.setViewVisibility(R.id.bonded_cta, View.GONE)
    line(views, "")
    // The 4 x 1 bar: no title row, tighter padding, one line each.
    val bar = size == StreakSize.BAR
    views.setViewVisibility(R.id.bonded_header, if (bar) View.GONE else View.VISIBLE)
    val pad = ((if (bar) 8 else 14) * context.resources.displayMetrics.density).toInt()
    views.setViewPadding(R.id.bonded_root, pad, pad, pad, pad)
    when (view) {
      is StreakView.Ready -> ready(context, views, view.cache, size)
      is StreakView.Locked -> {
        views.setViewVisibility(R.id.bonded_header, View.VISIBLE)
        views.setViewVisibility(R.id.bonded_lock, View.VISIBLE)
        line(views, BondedPremiumCopy.t("locked.premium"))
        cta(views, BondedPremiumCopy.t("locked.cta"), size)
        views.setOnClickPendingIntent(R.id.bonded_root, open(context, STREAK_PAYWALL_URL, REQUEST_PAYWALL))
      }
      is StreakView.Expired -> {
        views.setViewVisibility(R.id.bonded_header, View.VISIBLE)
        views.setTextViewText(R.id.bonded_title, BondedPremiumCopy.t("expired"))
        // The bar has no button, so it says "Open Bonded" as its line instead.
        line(views, if (bar) BondedPremiumCopy.t("open") else "")
        cta(views, BondedPremiumCopy.t("open"), size)
        views.setOnClickPendingIntent(R.id.bonded_root, open(context, STREAK_TODAY_URL, REQUEST_EXPIRED))
      }
    }
    return views
  }
}

/** 38c-4 Streak (Home Screen; 2 x 2, 4 x 2, 4 x 1). Read-only. */
class BondedStreakWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    // Draw what we had at once, then refresh from the server off the main thread.
    val last = StreakWidgets.lastView(context)
    for (id in ids) {
      manager.updateAppWidget(id, StreakWidgets.render(context, last, manager.getAppWidgetOptions(id)))
    }
    LittleThingsWidgets.runAsync(this) { StreakWidgets.refresh(context) }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    id: Int,
    options: Bundle?,
  ) {
    manager.updateAppWidget(id, StreakWidgets.render(context, StreakWidgets.lastView(context), options))
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
        StreakCache.clear(context, "expired")
        StreakWidgets.redraw(context, StreakView.Expired)
      }
    }
  }

  override fun onDisabled(context: Context) {
    StreakCache.clear(context, "expired")
  }
}
