package __PACKAGE__.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Base64
import android.view.View
import android.widget.RemoteViews
import __PACKAGE__.R
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import org.json.JSONArray
import org.json.JSONObject

// MOB-78 Little things widget for Android (screen 38c, D59, SEC-21 option A). Compiled only with the
// plugin's `premium: true`. Typechecked with kotlinc against android.jar (API 37) and an R stub;
// not yet built with Gradle or run on a device (plugins/widgets/README.md).
//
// - The token is read, never written, from expo-secure-store's private prefs (WidgetTokenStore).
// - The only network code: POST <supabase>/functions/v1/widget with `Authorization: Bearer bwt_…`,
//   no cache, nothing logged (WidgetClient). Nothing here calls android.util.Log.
// - Taps are explicit, immutable broadcasts to BondedLittleThingsActionReceiver (exported=false, no
//   intent-filter), one requestCode per kind. The receiver allow-lists the kind and does the network
//   call in goAsync() on a background thread, never on the main thread.
// - What the widget keeps between taps (LittleThingsCache, prefs `bonded_widget_little_things`): the
//   partner's first name, `premium`, the per-kind `at_limit` and the last tap's status. Never the
//   token, never answer, message or voice text. A 401 clears it.

/** Reads the widget token the app stored with expo-secure-store (src/features/widgets/tokens.ts). */
object WidgetTokenStore {
  // expo-secure-store 58.x Android layout (node_modules/expo-secure-store/android/.../
  // SecureStoreModule.kt and encryptors/AESEncryptor.kt), for setItemAsync('token', json,
  // { keychainService: 'bonded.widget' }) without requireAuthentication:
  // - prefs file "SecureStore" (MODE_PRIVATE), key "<keychainService>-<key>";
  // - value: JSON {"ct": base64, "iv": base64, "tlen": 128, "scheme": "aes",
  //   "usesKeystoreSuffix": true, "keystoreAlias": "bonded.widget", "requireAuthentication": false};
  // - key: AndroidKeyStore alias "AES/GCM/NoPadding:<keychainService>:keystoreUnauthenticated"
  //   (AES-256, GCM, no user authentication);
  // - plaintext: the app's JSON {"token": "bwt_…", "expires_at": "<ISO 8601>"}.
  // The prefs file is excluded from backup and device transfer (expo-secure-store plugin with
  // configureAndroidBackup in app.config.ts).
  const val PREFS = "SecureStore"
  const val SERVICE = "bonded.widget"
  const val KEY = "token"
  const val PREF_KEY = "$SERVICE-$KEY"
  const val KEY_ALIAS = "AES/GCM/NoPadding:$SERVICE:keystoreUnauthenticated"
  private const val MIN_TAG_BITS = 96
  private val TOKEN_SHAPE = Regex("^bwt_[A-Za-z0-9_-]{43}$")

  class Token(val token: String, val expiresAt: Long?)

  fun read(context: Context, now: Long = System.currentTimeMillis()): Token? {
    return try {
      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PREF_KEY, null)
        ?: return null
      val item = JSONObject(raw)
      if (item.optString("scheme") != "aes") return null
      if (!item.optBoolean("usesKeystoreSuffix", false)) return null
      if (item.optBoolean("requireAuthentication", false)) return null
      if (item.optString("keystoreAlias") != SERVICE) return null
      val tagBits = item.getInt("tlen")
      if (tagBits < MIN_TAG_BITS) return null
      val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
      val entry = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry ?: return null
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      val iv = Base64.decode(item.getString("iv"), Base64.DEFAULT)
      cipher.init(Cipher.DECRYPT_MODE, entry.secretKey, GCMParameterSpec(tagBits, iv))
      val plain = cipher.doFinal(Base64.decode(item.getString("ct"), Base64.DEFAULT))
      val value = JSONObject(String(plain, StandardCharsets.UTF_8))
      val token = value.optString("token")
      if (!TOKEN_SHAPE.matches(token)) return null
      val expiresAt = parseIso(value.optString("expires_at"))
      if (expiresAt != null && expiresAt <= now) return null
      Token(token, expiresAt)
    } catch (e: Exception) {
      // Missing key (reinstall), bad padding, unparsable JSON: the widget shows "Open Bonded".
      null
    }
  }

  private fun parseIso(value: String): Long? {
    if (value.isEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null
    return try {
      java.time.OffsetDateTime.parse(value).toInstant().toEpochMilli()
    } catch (e: Exception) {
      null
    }
  }
}

/** What a `widget` call ended as (CONTRACTS §3 `widget`). */
sealed class WidgetResponse {
  class Ok(val body: JSONObject) : WidgetResponse()
  /** 200 `state` with premium:false, or 403 PREMIUM_REQUIRED: the locked preview → paywall. */
  object Locked : WidgetResponse()
  /** No token, or 401 WIDGET_AUTH: "Open Bonded", no data. */
  object Expired : WidgetResponse()
  /** 409 LITTLE_THING_LIMIT. */
  class Limit(val kind: String?) : WidgetResponse()
  /** 409 UNDO_EXPIRED. */
  object UndoExpired : WidgetResponse()
  /** Offline, timeout, 429, 5xx, anything else. `retryable`: the server may not have the request. */
  class Failed(val retryable: Boolean) : WidgetResponse()
}

object WidgetClient {
  /** Set by plugins/widgets from the `supabaseUrl` prop (origin only). */
  const val ENDPOINT = "__SUPABASE_URL__/functions/v1/widget"
  /** CONTRACTS §3: the widget sends amount 1 of one of these. */
  val SENDABLE = setOf("hug", "kiss", "goodnight", "good_morning", "miss_you")
  private const val CONNECT_MS = 3000
  private const val READ_MS = 3000

  fun state(context: Context): WidgetResponse {
    val response = post(context, JSONObject().put("action", "state"))
    if (response is WidgetResponse.Ok && !response.body.optBoolean("premium", false)) {
      return WidgetResponse.Locked
    }
    return response
  }

  /** One tap = one new client id; pass the same one only to retry that tap. */
  fun send(context: Context, kind: String, clientId: UUID): WidgetResponse {
    if (kind !in SENDABLE) return WidgetResponse.Failed(false)
    val body = JSONObject().put("action", "send").put("kind", kind)
      .put("client_id", clientId.toString())
    return post(context, body)
  }

  fun undo(context: Context, id: String): WidgetResponse {
    try {
      UUID.fromString(id)
    } catch (e: IllegalArgumentException) {
      return WidgetResponse.Failed(false)
    }
    return post(context, JSONObject().put("action", "undo").put("id", id))
  }

  private fun post(context: Context, body: JSONObject): WidgetResponse {
    val token = WidgetTokenStore.read(context) ?: return WidgetResponse.Expired
    if (!ENDPOINT.startsWith("http")) return WidgetResponse.Failed(false)
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = CONNECT_MS
        readTimeout = READ_MS
        useCaches = false
        doOutput = true
        instanceFollowRedirects = false
        setRequestProperty("Authorization", "Bearer ${token.token}")
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Cache-Control", "no-store")
      }
      connection.outputStream.use { it.write(body.toString().toByteArray(StandardCharsets.UTF_8)) }
      val code = connection.responseCode
      val stream = if (code in 200..299) connection.inputStream else connection.errorStream
      val text = stream?.use { String(it.readBytes(), StandardCharsets.UTF_8) } ?: ""
      when (code) {
        200 -> WidgetResponse.Ok(JSONObject(text))
        401 -> WidgetResponse.Expired
        403 -> WidgetResponse.Locked
        409 -> {
          val error = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
          when (error.optString("error")) {
            "UNDO_EXPIRED" -> WidgetResponse.UndoExpired
            "LITTLE_THING_LIMIT" ->
              WidgetResponse.Limit(error.optString("kind").takeIf { it in SENDABLE })
            else -> WidgetResponse.Failed(false)
          }
        }
        else -> WidgetResponse.Failed(false)
      }
    } catch (e: IOException) {
      // Transport error: the server may not have the request (a retry reuses the client id).
      WidgetResponse.Failed(true)
    } catch (e: Exception) {
      WidgetResponse.Failed(false)
    } finally {
      connection?.disconnect()
    }
  }
}

/** `{widget_kind, action}` for analytics, flushed by the app (BondedWidgetsModule.takeActionQueue). */
object WidgetActionQueue {
  /** Same prefs and key as plugins/widgets/modules/bonded-widgets (the app side). */
  private const val PREFS = "bonded_widgets"
  private const val KEY = "actions"
  private const val MAX = 50
  /** src/lib/analytics/catalogue.ts WIDGET_KINDS / WIDGET_ACTIONS. */
  private val KINDS = setOf(
    "little_things", "thinking_of_you", "days_together", "streak", "todays_question", "mood",
    "on_this_day", "ritual_time",
  )
  private val ACTIONS = setOf("view_locked", "tap_open", "send", "undo", "send_failed")

  fun record(context: Context, kind: String, action: String) {
    if (kind !in KINDS || action !in ACTIONS) return
    // Same lock object as the module would need across classes: one process, prefs commit() inside.
    synchronized(WidgetActionQueue) {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val entries = try {
        JSONArray(prefs.getString(KEY, null) ?: "[]")
      } catch (e: Exception) {
        JSONArray()
      }
      entries.put(JSONObject().put("widget_kind", kind).put("action", action))
      val kept = JSONArray()
      for (i in maxOf(0, entries.length() - MAX) until entries.length()) kept.put(entries.get(i))
      prefs.edit().putString(KEY, kept.toString()).commit()
    }
  }
}

/** What the Little things widget keeps between taps (never the token, never any text but copy). */
class LittleThingsCache(
  val premium: Boolean?,
  val partner: String,
  val atLimit: Set<String>,
  /** "sent" | "limit" | "failed", or null. */
  val status: String?,
  val statusKind: String?,
  /** The little thing's id, for Undo (only for "sent"). */
  val sentId: String?,
  val statusAt: Long,
) {
  fun statusEndsAt(): Long =
    statusAt + if (status == "sent") UNDO_WINDOW_MS else SHOW_STATUS_MS

  fun liveStatus(now: Long): String? = if (status != null && now < statusEndsAt()) status else null

  fun undoable(now: Long): Boolean =
    status == "sent" && sentId != null && now < statusAt + UNDO_WINDOW_MS

  companion object {
    const val PREFS = "bonded_widget_little_things"
    private const val KEY = "state"
    const val UNDO_WINDOW_MS = 5_000L
    const val SHOW_STATUS_MS = 30_000L
    private const val NAME_MAX = 20

    val EMPTY = LittleThingsCache(null, "", emptySet(), null, null, null, 0)

    fun load(context: Context): LittleThingsCache {
      val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null)
        ?: return EMPTY
      return try {
        val o = JSONObject(raw)
        val limits = o.optJSONArray("atLimit") ?: JSONArray()
        LittleThingsCache(
          premium = if (o.has("premium")) o.getBoolean("premium") else null,
          partner = o.optString("partner").take(NAME_MAX),
          atLimit = (0 until limits.length()).map { limits.optString(it) }
            .filter { it in WidgetClient.SENDABLE }.toSet(),
          status = o.optString("status").takeIf { it in setOf("sent", "limit", "failed") },
          statusKind = o.optString("statusKind").takeIf { it in WidgetClient.SENDABLE },
          sentId = o.optString("sentId").takeIf { it.isNotEmpty() },
          statusAt = o.optLong("statusAt"),
        )
      } catch (e: Exception) {
        EMPTY
      }
    }

    fun save(context: Context, value: LittleThingsCache) {
      // Allow-listed keys only (no spreads of server JSON).
      val o = JSONObject()
        .put("partner", value.partner.take(NAME_MAX))
        .put("atLimit", JSONArray(value.atLimit.filter { it in WidgetClient.SENDABLE }))
        .put("statusAt", value.statusAt)
      value.premium?.let { o.put("premium", it) }
      value.status?.let { o.put("status", it) }
      value.statusKind?.let { o.put("statusKind", it) }
      value.sentId?.let { o.put("sentId", it) }
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(KEY, o.toString()).commit()
    }

    fun clear(context: Context) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
    }

    /** The allow-listed fields of a 200 `state` (premium couple). */
    fun fromState(body: JSONObject, previous: LittleThingsCache): LittleThingsCache {
      val limits = mutableSetOf<String>()
      val things = body.optJSONArray("little_things") ?: JSONArray()
      for (i in 0 until things.length()) {
        val thing = things.optJSONObject(i) ?: continue
        val kind = thing.optString("kind")
        if (kind in WidgetClient.SENDABLE && thing.optBoolean("at_limit", false)) limits.add(kind)
      }
      val name = if (body.isNull("partner_first_name")) "" else body.optString("partner_first_name")
      return LittleThingsCache(
        premium = true,
        partner = name.take(NAME_MAX),
        atLimit = limits,
        status = previous.status,
        statusKind = previous.statusKind,
        sentId = previous.sentId,
        statusAt = previous.statusAt,
      )
    }
  }
}

/** How the widget looks right now. */
sealed class LittleThingsView {
  class Ready(val cache: LittleThingsCache) : LittleThingsView()
  object Locked : LittleThingsView()
  object Expired : LittleThingsView()
  object Failed : LittleThingsView()
}

private const val PAYWALL_URL = "bonded://paywall?from=widget&widget_kind=little_things"
private const val OPEN_URL = "bonded://today"
private const val LOCKED_SEEN_KEY = "lockedSeen"
private const val VIEW_KEY = "view"

/** Shared by the provider and the action receiver. */
object LittleThingsWidgets {
  val SHOWN_KINDS_MEDIUM = listOf("hug", "good_morning", "goodnight")
  private val executor = Executors.newSingleThreadExecutor()

  /** Runs `work` off the main thread inside goAsync() (SEC-21: 10 s at most), then finishes. */
  fun runAsync(receiver: BroadcastReceiver, work: () -> Unit) {
    val pending = receiver.goAsync()
    executor.execute {
      try {
        work()
      } catch (e: Exception) {
        // Never log: the message could include a URL or a response.
      } finally {
        pending.finish()
      }
    }
  }

  fun ids(context: Context): IntArray =
    AppWidgetManager.getInstance(context)
      .getAppWidgetIds(ComponentName(context, BondedLittleThingsWidget::class.java))

  /** Fetches `state` (background thread only), stores the allow-listed fields, then redraws. */
  fun refresh(context: Context) {
    val view = when (val response = WidgetClient.state(context)) {
      is WidgetResponse.Ok -> {
        val cache = LittleThingsCache.fromState(response.body, LittleThingsCache.load(context))
        LittleThingsCache.save(context, cache)
        LittleThingsView.Ready(cache)
      }
      is WidgetResponse.Locked -> {
        LittleThingsCache.clear(context)
        LittleThingsView.Locked
      }
      is WidgetResponse.Expired -> {
        LittleThingsCache.clear(context)
        LittleThingsView.Expired
      }
      else -> {
        val cache = LittleThingsCache.load(context)
        if (cache.premium == true) LittleThingsView.Ready(cache) else LittleThingsView.Failed
      }
    }
    noteLocked(context, view is LittleThingsView.Locked)
    rememberView(context, view)
    redraw(context, view)
  }

  /** `view_locked` once per locked spell, not on every refresh. */
  private fun noteLocked(context: Context, locked: Boolean) {
    val prefs = context.getSharedPreferences(LittleThingsCache.PREFS, Context.MODE_PRIVATE)
    val seen = prefs.getBoolean(LOCKED_SEEN_KEY, false)
    if (locked && !seen) WidgetActionQueue.record(context, "little_things", "view_locked")
    prefs.edit().putBoolean(LOCKED_SEEN_KEY, locked).commit()
  }

  private fun rememberView(context: Context, view: LittleThingsView) {
    val name = when (view) {
      is LittleThingsView.Ready -> "ready"
      is LittleThingsView.Locked -> "locked"
      is LittleThingsView.Expired -> "expired"
      is LittleThingsView.Failed -> "failed"
    }
    context.getSharedPreferences(LittleThingsCache.PREFS, Context.MODE_PRIVATE).edit()
      .putString(VIEW_KEY, name).commit()
  }

  /** The last view without a network call (used by onUpdate before the refresh lands). */
  fun lastView(context: Context): LittleThingsView {
    val prefs = context.getSharedPreferences(LittleThingsCache.PREFS, Context.MODE_PRIVATE)
    return when (prefs.getString(VIEW_KEY, null)) {
      "ready" -> LittleThingsView.Ready(LittleThingsCache.load(context))
      "locked" -> LittleThingsView.Locked
      "failed" -> LittleThingsView.Failed
      else -> LittleThingsView.Expired
    }
  }

  fun redraw(context: Context, view: LittleThingsView) {
    val manager = AppWidgetManager.getInstance(context)
    for (id in ids(context)) {
      manager.updateAppWidget(id, render(context, view, manager.getAppWidgetOptions(id)))
    }
    if (view is LittleThingsView.Ready) scheduleStatusEnd(context, view.cache)
  }

  /** Back to the buttons when the Undo window (or the limit / failed line) ends. */
  private fun scheduleStatusEnd(context: Context, cache: LittleThingsCache) {
    val now = System.currentTimeMillis()
    if (cache.liveStatus(now) == null) return
    val alarm = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val intent = Intent(context, BondedLittleThingsActionReceiver::class.java)
      .setAction(BondedLittleThingsActionReceiver.ACTION_REDRAW)
    val pending = PendingIntent.getBroadcast(
      context,
      BondedLittleThingsActionReceiver.REQUEST_REDRAW,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val delay = cache.statusEndsAt() - now + 250
    alarm.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + delay, pending)
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

  /** An explicit, immutable broadcast to our own receiver, one requestCode per action and kind. */
  private fun action(context: Context, action: String, kind: String?, requestCode: Int): PendingIntent {
    val intent = Intent(context, BondedLittleThingsActionReceiver::class.java).setAction(action)
    if (kind != null) intent.putExtra(BondedLittleThingsActionReceiver.EXTRA_KIND, kind)
    return PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun sendLabel(kind: String, partner: String): String = when (kind) {
    "hug" -> BondedPremiumCopy.t("littleThings.send.hug", mapOf("partner" to partner))
    "good_morning" -> BondedPremiumCopy.t("littleThings.send.good_morning")
    else -> BondedPremiumCopy.t("littleThings.send.goodnight")
  }

  private fun doneLabel(kind: String): String = when (kind) {
    "hug" -> BondedPremiumCopy.t("littleThings.limit.hug")
    "kiss" -> BondedPremiumCopy.t("littleThings.limit.kiss")
    "miss_you" -> BondedPremiumCopy.t("littleThings.limit.miss_you")
    "good_morning" -> BondedPremiumCopy.t("littleThings.onceADay.good_morning")
    else -> BondedPremiumCopy.t("littleThings.onceADay.goodnight")
  }

  private val BUTTONS = mapOf(
    "hug" to R.id.bonded_send_hug,
    "good_morning" to R.id.bonded_send_good_morning,
    "goodnight" to R.id.bonded_send_goodnight,
  )

  fun render(context: Context, view: LittleThingsView, options: Bundle?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.bonded_widget_little_things)
    views.setTextViewText(R.id.bonded_title, BondedPremiumCopy.t("littleThings.name"))
    views.setViewVisibility(R.id.bonded_undo, View.GONE)
    when (view) {
      is LittleThingsView.Ready -> ready(context, views, view.cache, options)
      is LittleThingsView.Locked -> {
        views.setViewVisibility(R.id.bonded_buttons, View.GONE)
        views.setViewVisibility(R.id.bonded_lock, View.VISIBLE)
        views.setTextViewText(R.id.bonded_line, BondedPremiumCopy.t("locked.premium"))
        views.setViewVisibility(R.id.bonded_cta, View.VISIBLE)
        views.setTextViewText(R.id.bonded_cta, BondedPremiumCopy.t("locked.cta"))
        views.setOnClickPendingIntent(R.id.bonded_root, open(context, PAYWALL_URL, REQUEST_PAYWALL))
      }
      is LittleThingsView.Expired, is LittleThingsView.Failed -> {
        views.setViewVisibility(R.id.bonded_buttons, View.GONE)
        views.setViewVisibility(R.id.bonded_lock, View.GONE)
        if (view is LittleThingsView.Expired) {
          views.setTextViewText(R.id.bonded_title, BondedPremiumCopy.t("expired"))
          views.setTextViewText(R.id.bonded_line, "")
        } else {
          views.setTextViewText(R.id.bonded_line, BondedPremiumCopy.t("littleThings.failed"))
        }
        views.setViewVisibility(R.id.bonded_cta, View.VISIBLE)
        views.setTextViewText(R.id.bonded_cta, BondedPremiumCopy.t("open"))
        views.setOnClickPendingIntent(R.id.bonded_root, open(context, OPEN_URL, REQUEST_OPEN))
      }
    }
    return views
  }

  private fun ready(context: Context, views: RemoteViews, cache: LittleThingsCache, options: Bundle?) {
    val now = System.currentTimeMillis()
    val width = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH) ?: 0
    val kinds = if (width < 250) listOf("hug") else SHOWN_KINDS_MEDIUM
    views.setViewVisibility(R.id.bonded_lock, View.GONE)
    views.setViewVisibility(R.id.bonded_cta, View.GONE)
    views.setViewVisibility(R.id.bonded_buttons, View.VISIBLE)
    views.setOnClickPendingIntent(R.id.bonded_root, open(context, OPEN_URL, REQUEST_OPEN))
    val line = when (cache.liveStatus(now)) {
      "sent" -> BondedPremiumCopy.t("littleThings.sent", mapOf("partner" to cache.partner))
      "limit" -> doneLabel(cache.statusKind ?: "hug")
      "failed" -> BondedPremiumCopy.t("littleThings.failed")
      else -> BondedPremiumCopy.t("littleThings.tapToSend")
    }
    views.setTextViewText(R.id.bonded_line, line)
    if (cache.undoable(now)) {
      views.setViewVisibility(R.id.bonded_undo, View.VISIBLE)
      views.setTextViewText(R.id.bonded_undo, BondedPremiumCopy.t("littleThings.undo"))
      views.setOnClickPendingIntent(
        R.id.bonded_undo,
        action(context, BondedLittleThingsActionReceiver.ACTION_UNDO, null, REQUEST_UNDO),
      )
    }
    for ((kind, id) in BUTTONS) {
      if (kind !in kinds) {
        views.setViewVisibility(id, View.GONE)
        continue
      }
      views.setViewVisibility(id, View.VISIBLE)
      val done = kind in cache.atLimit
      views.setTextViewText(id, if (done) doneLabel(kind) else sendLabel(kind, cache.partner))
      views.setBoolean(id, "setEnabled", !done)
      if (!done) {
        views.setOnClickPendingIntent(
          id,
          action(context, BondedLittleThingsActionReceiver.ACTION_SEND, kind, sendRequestCode(kind)),
        )
      }
    }
  }

  const val REQUEST_OPEN = 7_800
  const val REQUEST_PAYWALL = 7_801
  const val REQUEST_UNDO = 7_802

  /** A distinct requestCode per kind, so one kind's PendingIntent never replaces another's. */
  fun sendRequestCode(kind: String): Int = when (kind) {
    "hug" -> 7_810
    "kiss" -> 7_811
    "goodnight" -> 7_812
    "good_morning" -> 7_813
    else -> 7_814 // miss_you
  }
}

/** 38c Little things (Home Screen; 2 x 2 shows "hug", 4 x 2 and wider shows three kinds). */
class BondedLittleThingsWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    // Draw what we had at once, then refresh from the server off the main thread.
    val last = LittleThingsWidgets.lastView(context)
    for (id in ids) {
      manager.updateAppWidget(id, LittleThingsWidgets.render(context, last, manager.getAppWidgetOptions(id)))
    }
    LittleThingsWidgets.runAsync(this) { LittleThingsWidgets.refresh(context) }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    id: Int,
    options: Bundle?,
  ) {
    manager.updateAppWidget(id, LittleThingsWidgets.render(context, LittleThingsWidgets.lastView(context), options))
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
        LittleThingsCache.clear(context)
        LittleThingsWidgets.redraw(context, LittleThingsView.Expired)
      }
    }
  }

  override fun onDisabled(context: Context) {
    LittleThingsCache.clear(context)
  }
}

/**
 * The widget's taps. exported="false" with no intent-filter: only this app's own explicit,
 * immutable PendingIntents reach it. The kind is checked against the allow-list again here.
 */
class BondedLittleThingsActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_SEND -> {
        val kind = intent.getStringExtra(EXTRA_KIND) ?: return
        if (kind !in WidgetClient.SENDABLE) return
        LittleThingsWidgets.runAsync(this) { send(context, kind) }
      }
      ACTION_UNDO -> LittleThingsWidgets.runAsync(this) { undo(context) }
      ACTION_REDRAW -> LittleThingsWidgets.redraw(context, LittleThingsWidgets.lastView(context))
    }
  }

  private fun send(context: Context, kind: String) {
    val started = SystemClock.elapsedRealtime()
    val clientId = UUID.randomUUID()
    var response = WidgetClient.send(context, kind, clientId)
    // One retry of the same tap (same client id) if the first never reached the server and there
    // is time left inside goAsync's budget.
    if (response is WidgetResponse.Failed && response.retryable &&
      SystemClock.elapsedRealtime() - started < RETRY_BEFORE_MS
    ) {
      response = WidgetClient.send(context, kind, clientId)
    }
    val now = System.currentTimeMillis()
    val cache = LittleThingsCache.load(context)
    when (response) {
      is WidgetResponse.Ok -> {
        val id = response.body.optString("id")
        val limits = if (response.body.optBoolean("at_limit", false)) cache.atLimit + kind else cache.atLimit
        LittleThingsCache.save(
          context,
          LittleThingsCache(true, cache.partner, limits, "sent", kind, id.ifEmpty { null }, now),
        )
        WidgetActionQueue.record(context, "little_things", "send")
        LittleThingsWidgets.redraw(context, LittleThingsView.Ready(LittleThingsCache.load(context)))
      }
      is WidgetResponse.Limit -> {
        val limitKind = response.kind ?: kind
        LittleThingsCache.save(
          context,
          LittleThingsCache(true, cache.partner, cache.atLimit + limitKind, "limit", limitKind, null, now),
        )
        WidgetActionQueue.record(context, "little_things", "send_failed")
        LittleThingsWidgets.redraw(context, LittleThingsView.Ready(LittleThingsCache.load(context)))
      }
      is WidgetResponse.Locked, is WidgetResponse.Expired -> LittleThingsWidgets.refresh(context)
      else -> {
        LittleThingsCache.save(
          context,
          LittleThingsCache(cache.premium, cache.partner, cache.atLimit, "failed", kind, null, now),
        )
        WidgetActionQueue.record(context, "little_things", "send_failed")
        LittleThingsWidgets.redraw(context, LittleThingsView.Ready(LittleThingsCache.load(context)))
      }
    }
  }

  private fun undo(context: Context) {
    // Only the little thing this widget just sent, and only inside its 5 s window.
    val cache = LittleThingsCache.load(context)
    val id = cache.sentId
    if (id != null && cache.undoable(System.currentTimeMillis())) {
      val response = WidgetClient.undo(context, id)
      if (response is WidgetResponse.Ok) {
        WidgetActionQueue.record(context, "little_things", "undo")
      }
    }
    // Undone, expired or failed: back to the buttons with fresh limits.
    LittleThingsCache.save(
      context,
      LittleThingsCache(cache.premium, cache.partner, cache.atLimit, null, null, null, 0),
    )
    LittleThingsWidgets.refresh(context)
  }

  companion object {
    const val ACTION_SEND = "com.hellobonded.widgets.littlethings.SEND"
    const val ACTION_UNDO = "com.hellobonded.widgets.littlethings.UNDO"
    const val ACTION_REDRAW = "com.hellobonded.widgets.littlethings.REDRAW"
    const val EXTRA_KIND = "kind"
    const val REQUEST_REDRAW = 7_803
    private const val RETRY_BEFORE_MS = 3_500L
  }
}
