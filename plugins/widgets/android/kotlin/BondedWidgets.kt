package __PACKAGE__.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import __PACKAGE__.R
import org.json.JSONObject

// Home-screen widgets (MOB-30, screen 38, D26) and the "your turn" pair (38b, D47).
// RemoteViews, not Glance: see plugins/widgets/README.md. The app writes the snapshot through
// plugins/widgets/modules/bonded-widgets and broadcasts REFRESH; tapping opens Today
// (bonded://today?widget=<layout>, the layout is for analytics only).
// Reveal rule (FUN-04): the snapshot has booleans, the deadline, counts and a first name only.

const val BONDED_WIDGET_PREFS = "bonded_widgets"
const val BONDED_WIDGET_KEY = "snapshot"
const val BONDED_WIDGET_REFRESH = "com.trybonded.widgets.REFRESH"
private const val SNAPSHOT_VERSION = 1

data class BondedSnapshot(
  val state: String,
  val mood: String,
  val streak: Int,
  val dayEndsAt: Long?,
  val text: Map<String, String>,
) {
  fun t(key: String): String = text[key] ?: ""

  fun isNewDay(now: Long): Boolean = dayEndsAt != null && now >= dayEndsAt

  companion object {
    fun load(context: Context): BondedSnapshot? {
      val json = context.getSharedPreferences(BONDED_WIDGET_PREFS, Context.MODE_PRIVATE)
        .getString(BONDED_WIDGET_KEY, null) ?: return null
      return try {
        val o = JSONObject(json)
        if (o.optInt("v") != SNAPSHOT_VERSION) return null
        val t = o.getJSONObject("text")
        val text = t.keys().asSequence().associateWith { t.optString(it) }
        BondedSnapshot(
          state = o.optString("state", "none"),
          mood = o.optString("mood", "snuggled"),
          streak = o.optInt("streak"),
          dayEndsAt = if (o.isNull("dayEndsAt")) null else o.optLong("dayEndsAt"),
          text = text,
        )
      } catch (e: Exception) {
        null
      }
    }
  }
}

private fun mascotRes(mood: String): Int = when (mood) {
  "waiting" -> R.drawable.bonded_widget_mascot_waiting
  "celebrating" -> R.drawable.bonded_widget_mascot_celebrating
  "napping" -> R.drawable.bonded_widget_mascot_napping
  "saving-a-seat" -> R.drawable.bonded_widget_mascot_saving_a_seat
  "together" -> R.drawable.bonded_widget_mascot_together
  else -> R.drawable.bonded_widget_mascot_snuggled
}

private fun openToday(context: Context, layout: String): PendingIntent {
  val intent = Intent(Intent.ACTION_VIEW, Uri.parse("bonded://today?widget=$layout"))
    .setPackage(context.packageName)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  return PendingIntent.getActivity(
    context,
    layout.hashCode(),
    intent,
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )
}

/** Base for both widgets: redraw on update, on REFRESH from the app and at the day's end. */
abstract class BondedWidgetProvider : AppWidgetProvider() {
  abstract fun render(context: Context, snapshot: BondedSnapshot?, options: Bundle?): RemoteViews

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val snapshot = BondedSnapshot.load(context)
    for (id in ids) manager.updateAppWidget(id, render(context, snapshot, manager.getAppWidgetOptions(id)))
    scheduleDayEnd(context, snapshot)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    id: Int,
    options: Bundle?,
  ) {
    manager.updateAppWidget(id, render(context, BondedSnapshot.load(context), options))
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action == BONDED_WIDGET_REFRESH) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, javaClass))
      if (ids.isNotEmpty()) onUpdate(context, manager, ids)
    }
  }

  /** An inexact alarm at the couple's midnight flips the widget to "New question". */
  private fun scheduleDayEnd(context: Context, snapshot: BondedSnapshot?) {
    val ends = snapshot?.dayEndsAt ?: return
    if (ends <= System.currentTimeMillis()) return
    val alarm = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val intent = Intent(context, javaClass).setAction(BONDED_WIDGET_REFRESH)
    val pending = PendingIntent.getBroadcast(
      context,
      javaClass.name.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    alarm.set(AlarmManager.RTC, ends + 1000, pending)
  }

  protected fun small(context: Context, s: BondedSnapshot?, now: Long): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.bonded_widget_today_small)
    if (s == null) {
      views.setImageViewResource(R.id.bonded_mascot, mascotRes("snuggled"))
      views.setTextViewText(R.id.bonded_day, context.getString(R.string.bonded_widget_name))
      views.setTextViewText(R.id.bonded_line, context.getString(R.string.bonded_widget_open))
    } else if (s.isNewDay(now)) {
      views.setImageViewResource(R.id.bonded_mascot, mascotRes("waiting"))
      views.setTextViewText(R.id.bonded_day, s.t("newDayTitle"))
      views.setTextViewText(R.id.bonded_line, s.t("newDayLine"))
    } else {
      views.setImageViewResource(R.id.bonded_mascot, mascotRes(s.mood))
      views.setTextViewText(R.id.bonded_day, s.t("day").ifEmpty { s.t("title") })
      views.setTextViewText(R.id.bonded_line, s.t("line"))
    }
    views.setOnClickPendingIntent(R.id.bonded_root, openToday(context, "today"))
    return views
  }

  protected fun setCountdown(views: RemoteViews, id: Int, ends: Long, now: Long) {
    views.setChronometer(id, SystemClock.elapsedRealtime() + (ends - now), null, true)
    views.setChronometerCountDown(id, true)
  }
}

/** 38: small (2 x 2) and medium (4 x 2) by size; also offered on the lock screen (keyguard). */
class BondedTodayWidget : BondedWidgetProvider() {
  override fun render(context: Context, snapshot: BondedSnapshot?, options: Bundle?): RemoteViews {
    val now = System.currentTimeMillis()
    val width = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 0
    if (width < 250 || snapshot == null) return small(context, snapshot, now)
    val s = snapshot
    val views = RemoteViews(context.packageName, R.layout.bonded_widget_today_medium)
    val newDay = s.isNewDay(now)
    views.setImageViewResource(R.id.bonded_mascot, mascotRes(if (newDay) "waiting" else s.mood))
    views.setTextViewText(R.id.bonded_title, if (newDay) s.t("newDayTitle") else s.t("title"))
    views.setTextViewText(R.id.bonded_sub, if (newDay) s.t("newDayLine") else s.t("sub"))
    val ends = s.dayEndsAt
    if (!newDay && s.state != "none" && ends != null) {
      views.setViewVisibility(R.id.bonded_timer_row, View.VISIBLE)
      views.setTextViewText(R.id.bonded_timer_label, s.t("timer"))
      setCountdown(views, R.id.bonded_timer, ends, now)
    } else {
      views.setViewVisibility(R.id.bonded_timer_row, View.GONE)
    }
    views.setOnClickPendingIntent(R.id.bonded_root, openToday(context, "today"))
    return views
  }
}

/** 38b (small): Countdown while it's my turn, Partner answered when they have and I haven't. */
class BondedYourTurnWidget : BondedWidgetProvider() {
  override fun render(context: Context, snapshot: BondedSnapshot?, options: Bundle?): RemoteViews {
    val now = System.currentTimeMillis()
    val s = snapshot ?: return small(context, null, now)
    val ends = s.dayEndsAt
    if (s.isNewDay(now)) return small(context, s, now)
    if (s.state == "partnerAnswered") {
      val views = RemoteViews(context.packageName, R.layout.bonded_widget_partner_answered)
      views.setImageViewResource(R.id.bonded_mascot, mascotRes(s.mood))
      views.setTextViewText(R.id.bonded_title, s.t("title"))
      views.setTextViewText(R.id.bonded_sub, s.t("sub"))
      views.setTextViewText(R.id.bonded_cta, s.t("cta"))
      views.setContentDescription(R.id.bonded_root, "${s.t("title")}. ${s.t("sub")}")
      views.setOnClickPendingIntent(R.id.bonded_root, openToday(context, "partner_answered"))
      return views
    }
    if ((s.state == "yourTurn" || s.state == "napping") && ends != null) {
      val views = RemoteViews(context.packageName, R.layout.bonded_widget_countdown)
      views.setImageViewResource(R.id.bonded_mascot, mascotRes(s.mood))
      views.setTextViewText(R.id.bonded_turn, s.t("turn"))
      setCountdown(views, R.id.bonded_timer, ends, now)
      views.setTextViewText(R.id.bonded_keep, s.t("keep"))
      views.setTextViewText(R.id.bonded_cta, s.t("cta"))
      views.setOnClickPendingIntent(R.id.bonded_root, openToday(context, "countdown"))
      return views
    }
    return small(context, s, now)
  }
}
