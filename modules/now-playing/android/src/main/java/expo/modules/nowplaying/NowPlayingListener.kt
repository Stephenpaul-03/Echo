package expo.modules.nowplaying

import android.service.notification.NotificationListenerService

class NowPlayingListener : NotificationListenerService() {
  override fun onListenerConnected() {
    super.onListenerConnected()
    SessionRepository.initialize(applicationContext)
    SessionRepository.setConnected(true)
  }

  override fun onListenerDisconnected() {
    SessionRepository.setConnected(false)
    super.onListenerDisconnected()
  }

  override fun onDestroy() {
    SessionRepository.setConnected(false)
    super.onDestroy()
  }
}
