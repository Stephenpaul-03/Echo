package expo.modules.nowplaying

import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.provider.Settings
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NowPlayingModule : Module() {
  private val coordinator = NowPlayingCoordinator()

  private fun ensureCoordinator() {
    appContext.reactContext?.let { context ->
      coordinator.start(context.applicationContext) { name, payload ->
        // The coordinator may receive a late event while Expo is tearing down.
        runCatching { sendEvent(name, payload) }
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("NowPlaying")
    Events("onTrackUpdate", "onNoSession", "onDisconnected", "onVolumeChanged")

    OnStartObserving("onTrackUpdate") {
      SessionRepository.main.post { ensureCoordinator(); coordinator.refresh() }
    }
    OnStopObserving("onTrackUpdate") {
      SessionRepository.main.post { coordinator.stop() }
    }
    OnDestroy {
      SessionRepository.main.post { coordinator.stop() }
    }

    AsyncFunction("getPermissionStatus") {
      val context = requireNotNull(appContext.reactContext)
      SessionRepository.initialize(context.applicationContext)
      SessionRepository.hasPermission()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("requestPermission") {
      val context = requireNotNull(appContext.reactContext)
      context.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      })
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setLandscapeOrientation") {
      requireNotNull(appContext.currentActivity).requestedOrientation =
        ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("resetOrientation") {
      requireNotNull(appContext.currentActivity).requestedOrientation =
        ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("refreshSessions") {
      ensureCoordinator()
      coordinator.refresh()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getDataSourceMode") {
      val context = requireNotNull(appContext.reactContext).applicationContext
      coordinator.getMode(context)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setDataSourceMode") { mode: String ->
      val context = requireNotNull(appContext.reactContext).applicationContext
      ensureCoordinator()
      coordinator.setMode(context, mode)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getVolume") { sessionId: String? ->
      ensureCoordinator()
      coordinator.getVolume(sessionId)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("changeVolume") { sessionId: String?, level: Double?, direction: Int ->
      ensureCoordinator()
      coordinator.changeVolume(sessionId, level, direction)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getAppearance") {
      val preferences = requireNotNull(appContext.reactContext).getSharedPreferences("echo-appearance", Context.MODE_PRIVATE)
      mapOf("mode" to preferences.getString("mode", "system"), "accent" to preferences.getString("accent", "sage"))
    }
    AsyncFunction("setAppearance") { mode: String, accent: String ->
      require(mode in listOf("dark", "light", "system"))
      require(accent in listOf("sage", "sky", "amber", "rose", "lilac"))
      requireNotNull(appContext.reactContext).getSharedPreferences("echo-appearance", Context.MODE_PRIVATE)
        .edit().putString("mode", mode).putString("accent", accent).apply()
    }

    AsyncFunction("control") { action: String, sessionId: String, positionMs: Double ->
      ensureCoordinator()
      coordinator.control(action, sessionId, positionMs.toLong())
    }.runOnQueue(Queues.MAIN)
  }
}
