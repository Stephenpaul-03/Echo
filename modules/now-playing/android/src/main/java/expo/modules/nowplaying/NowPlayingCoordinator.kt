package expo.modules.nowplaying

import android.content.Context

/** Selects Poweramp when its API is live and keeps the existing media-session path as fallback. */
internal class NowPlayingCoordinator {
  companion object {
    private const val PREFERENCES = "echo-now-playing"
    private const val MODE_KEY = "data-source-mode"
    const val AUTO = "auto"
    const val POWERAMP = "poweramp"
    const val FALLBACK = "fallback"
  }

  private val powerAmp = PowerAmpDataSource()
  private val fallback = NotificationListenerDataSource()
  private var listener: ((String, Map<String, Any?>) -> Unit)? = null
  private var powerAmpActive = false
  private var mode = POWERAMP

  fun start(context: Context, listener: (String, Map<String, Any?>) -> Unit) {
    this.listener = listener
    mode = storedMode(context)
    fallback.start(context) { event, payload ->
      val source = payload["source"]?.toString()
      if (mode == FALLBACK || (mode == AUTO && (!powerAmpActive || (event == "onTrackUpdate" && source != "Poweramp")))) {
        if (event == "onTrackUpdate" && source != "Poweramp") powerAmpActive = false
        listener(event, payload)
      }
    }
    powerAmp.start(context) powerAmpListener@ { event, payload ->
      if (mode == FALLBACK) return@powerAmpListener
      when (event) {
        "onTrackUpdate" -> {
          powerAmpActive = true
          listener("onTrackUpdate", payload)
        }
        "onNoSession", "onDisconnected" -> {
          powerAmpActive = false
          if (mode == POWERAMP) listener(event, payload)
          else {
            val fallbackHealth = fallback.refresh()
            @Suppress("UNCHECKED_CAST")
            val fallbackTrack = fallbackHealth?.get("track") as? Map<String, Any?>
            if (fallbackTrack != null) listener("onTrackUpdate", fallbackTrack)
            else listener(event, payload)
          }
        }
        else -> listener(event, payload)
      }
    }
  }

  fun stop() {
    powerAmp.stop()
    fallback.stop()
    listener = null
    powerAmpActive = false
  }

  fun refresh(): Map<String, Any?>? {
    if (mode == POWERAMP) {
      val health = powerAmp.refresh()
      powerAmpActive = health?.get("track") != null
      return health ?: mapOf("permission" to true, "connected" to false, "track" to null)
    }
    if (mode == FALLBACK) {
      powerAmpActive = false
      return fallback.refresh()
    }
    val powerHealth = powerAmp.refresh()
    @Suppress("UNCHECKED_CAST")
    val powerTrack = powerHealth?.get("track") as? Map<String, Any?>
    val fallbackHealth = fallback.refresh()
    @Suppress("UNCHECKED_CAST")
    val fallbackTrack = fallbackHealth?.get("track") as? Map<String, Any?>
    // If another app owns the fallback session, Poweramp is no longer the primary source.
    if (fallbackTrack != null && fallbackTrack["source"]?.toString() != "Poweramp") {
      powerAmpActive = false
      return fallbackHealth
    }
    if (powerTrack != null) {
      powerAmpActive = true
      return powerHealth
    }
    powerAmpActive = false
    return fallbackHealth
  }

  fun getMode(context: Context): String {
    mode = storedMode(context)
    return mode
  }

  fun setMode(context: Context, next: String): Map<String, Any?>? {
    require(next in listOf(AUTO, POWERAMP, FALLBACK))
    mode = next
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString(MODE_KEY, next).apply()
    return refresh()
  }

  private fun storedMode(context: Context): String =
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getString(MODE_KEY, POWERAMP)
      ?.let { if (it == AUTO) POWERAMP else it }
      ?.takeIf { it in listOf(POWERAMP, FALLBACK) } ?: POWERAMP

  fun control(action: String, sessionId: String, positionMs: Long): Boolean =
    if (powerAmpActive && powerAmp.ownsSession(sessionId)) powerAmp.control(action, sessionId, positionMs)
    else fallback.control(action, sessionId, positionMs)

  fun getVolume(sessionId: String?): Map<String, Any?> =
    if (sessionId == "poweramp") SessionRepository.volume(null) + ("sessionId" to sessionId)
    else SessionRepository.volume(sessionId)

  fun changeVolume(sessionId: String?, level: Double?, direction: Int): Map<String, Any?> =
    if (sessionId == "poweramp") SessionRepository.changeVolume(null, level, direction) + ("sessionId" to sessionId)
    else SessionRepository.changeVolume(sessionId, level, direction)
}
