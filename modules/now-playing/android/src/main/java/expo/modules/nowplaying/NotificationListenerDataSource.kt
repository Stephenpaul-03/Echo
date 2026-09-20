package expo.modules.nowplaying

import android.content.Context

/** Adapter around the existing NotificationListener/MediaSession implementation. */
internal class NotificationListenerDataSource : NowPlayingDataSource {
  override fun start(context: Context, listener: (String, Map<String, Any?>) -> Unit) {
    SessionRepository.initialize(context.applicationContext)
    SessionRepository.observer = listener
  }

  override fun stop() { SessionRepository.observer = null }

  override fun refresh(): Map<String, Any?>? = SessionRepository.refresh()

  override fun control(action: String, sessionId: String, positionMs: Long) =
    SessionRepository.control(action, sessionId, positionMs)

  override fun ownsSession(sessionId: String) = SessionRepository.controlSessionMatches(sessionId)
}
