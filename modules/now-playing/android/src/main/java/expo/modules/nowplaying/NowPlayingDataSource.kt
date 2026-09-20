package expo.modules.nowplaying

import android.content.Context

/** Unified native contract used by the Poweramp primary source and media-session fallback. */
internal interface NowPlayingDataSource {
  fun start(context: Context, listener: (String, Map<String, Any?>) -> Unit)
  fun stop()
  fun refresh(): Map<String, Any?>?
  fun control(action: String, sessionId: String, positionMs: Long): Boolean
  fun ownsSession(sessionId: String): Boolean
}
