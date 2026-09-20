package expo.modules.nowplaying

import android.app.NotificationManager
import android.os.Build
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.media.VolumeProvider
import android.media.MediaMetadata
import android.media.session.MediaController
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import androidx.core.content.FileProvider
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.service.notification.NotificationListenerService
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

/** All session state lives on the main looper; image IO uses a single background worker. */
internal object SessionRepository {
  private const val QUEUE_LOOKAHEAD = 18
  private const val ARTWORK_LOOKAHEAD = 4
  val main = Handler(Looper.getMainLooper())
  var observer: ((String, Map<String, Any?>) -> Unit)? = null
  private lateinit var context: Context
  private lateinit var manager: MediaSessionManager
  private lateinit var component: ComponentName
  private var connected = false
  private var listenerConnected = false
  private var registered = false
  private var selected: String? = null
  private var nextId = 0L
  private val entries = linkedMapOf<String, Entry>()
  private val artworkWorker = Executors.newSingleThreadExecutor()
  private var artworkGeneration = 0L
  private var lastRebind = 0L
  private val artworkCache = object : LinkedHashMap<String, String?>(16, .75f, true) {
    // Eviction forgets the lookup, never deletes a file held by a mounted image.
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String?>) = size > 96
  }
  private val artworkRetry = ArtworkRetryPolicy()
  private val artworkRetryTask = Runnable { scheduleEmission() }
  private val pendingArt = mutableSetOf<String>()
  private var emissionScheduled = false
  private val emitTask = Runnable { emissionScheduled = false; emitSnapshot() }
  private val sessionListener = MediaSessionManager.OnActiveSessionsChangedListener { controllers ->
    updateControllers(controllers.orEmpty())
  }

  private class Entry(val id: String, val controller: MediaController, var changedAt: Long) {
    lateinit var callback: MediaController.Callback
  }

  fun initialize(appContext: Context) {
    if (::context.isInitialized) return
    context = appContext
    manager = context.getSystemService(Context.MEDIA_SESSION_SERVICE) as MediaSessionManager
    component = ComponentName(context, NowPlayingListener::class.java)
    // Keep reusable artwork across launches; prune only before any image is mounted.
    artworkWorker.execute {
      val files = File(context.cacheDir, "now-playing-art").apply { mkdirs() }
        .listFiles().orEmpty().sortedByDescending { it.lastModified() }
      var bytes = 0L
      val cutoff = System.currentTimeMillis() - 7L * 24 * 60 * 60 * 1000
      files.forEach { file ->
        bytes += file.length()
        if (file.lastModified() < cutoff || bytes > 128L * 1024 * 1024) file.delete()
      }
    }
  }

  fun hasPermission(): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      return (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .isNotificationListenerAccessGranted(component)
    }
    return Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")
      ?.split(':')?.any { ComponentName.unflattenFromString(it) == component } == true
  }

  fun setConnected(value: Boolean) {
    if (Looper.myLooper() != Looper.getMainLooper()) { main.post { setConnected(value) }; return }
    listenerConnected = value
    connected = value
    if (value) refresh() else {
      clearControllers()
      observer?.invoke("onDisconnected", emptyMap())
    }
  }

  fun refresh(): Map<String, Any?> {
    val permission = hasPermission()
    if (!permission) {
      connected = false
      clearControllers()
      return mapOf("permission" to false, "connected" to false, "track" to null)
    }
    return try {
      if (!registered) {
        manager.addOnActiveSessionsChangedListener(sessionListener, component, main)
        registered = true
      }
      updateControllers(manager.getActiveSessions(component))
      // A successful query plus a registered session listener is a healthy media connection.
      // The notification service may still be rebinding after access is restored.
      connected = true
      if (!listenerConnected && SystemClock.elapsedRealtime() - lastRebind > 10_000) {
        lastRebind = SystemClock.elapsedRealtime()
        NotificationListenerService.requestRebind(component)
      }
      mapOf("permission" to true, "connected" to connected, "track" to snapshot())
    } catch (_: SecurityException) {
      connected = false
      clearControllers()
      mapOf("permission" to hasPermission(), "connected" to false, "track" to null)
    }
  }

  private fun clearControllers() {
    main.removeCallbacks(emitTask)
    main.removeCallbacks(artworkRetryTask)
    emissionScheduled = false
    entries.values.forEach { runCatching { it.controller.unregisterCallback(it.callback) } }
    entries.clear()
    selected = null
    artworkGeneration++
    pendingArt.clear()
    if (registered) runCatching { manager.removeOnActiveSessionsChangedListener(sessionListener) }
    registered = false
  }

  private fun updateControllers(controllers: List<MediaController>) {
    val removed = entries.values.filter { entry -> controllers.none { it.sessionToken == entry.controller.sessionToken } }
    removed.forEach {
      it.controller.unregisterCallback(it.callback)
      entries.remove(it.id)
    }
    controllers.forEach { controller ->
      if (entries.values.none { it.controller.sessionToken == controller.sessionToken }) {
        val entry = Entry("${controller.packageName}:${++nextId}", controller, controller.playbackState?.lastPositionUpdateTime ?: 0)
        entry.callback = object : MediaController.Callback() {
          override fun onPlaybackStateChanged(state: PlaybackState?) {
            entry.changedAt = SystemClock.elapsedRealtime()
            chooseSession()
            scheduleEmission()
          }
          override fun onMetadataChanged(metadata: MediaMetadata?) { scheduleEmission() }
          override fun onQueueChanged(queue: MutableList<android.media.session.MediaSession.QueueItem>?) { scheduleEmission() }
          override fun onAudioInfoChanged(info: MediaController.PlaybackInfo) {
            if (selected == entry.id) observer?.invoke("onVolumeChanged", volume(entry.id))
          }
          override fun onSessionDestroyed() {
            controller.unregisterCallback(this)
            entries.remove(entry.id)
            chooseSession()
            scheduleEmission()
          }
        }
        entries[entry.id] = entry
        controller.registerCallback(entry.callback, main)
      }
    }
    chooseSession()
    scheduleEmission()
  }

  private fun chooseSession() {
    val next = SessionPolicy.select(entries.values.map {
      SessionCandidate(it.id, it.controller.playbackState?.state ?: 0, it.changedAt)
    }, selected)
    if (next != selected) {
      selected = next
      main.removeCallbacks(artworkRetryTask)
      artworkGeneration++
      pendingArt.clear()
    }
  }

  private fun scheduleEmission() {
    // Artwork completions must not keep pushing the queue update into the future.
    if (emissionScheduled) return
    emissionScheduled = true
    main.postDelayed(emitTask, 80)
  }

  private fun emitSnapshot() {
    if (!connected || !hasPermission()) return
    val track = snapshot()
    observer?.invoke(if (track == null) "onNoSession" else "onTrackUpdate", track ?: emptyMap())
  }

  private fun text(metadata: MediaMetadata?, key: String) = metadata?.getText(key)?.toString().orEmpty()

  private fun snapshot(): Map<String, Any?>? {
    val entry = entries[selected] ?: return null
    val controller = entry.controller
    val metadata = controller.metadata
    val state = controller.playbackState
    val title = text(metadata, MediaMetadata.METADATA_KEY_TITLE).ifBlank { metadata?.description?.title?.toString().orEmpty().ifBlank { "Unknown track" } }
    val artist = text(metadata, MediaMetadata.METADATA_KEY_ARTIST).ifBlank { text(metadata, MediaMetadata.METADATA_KEY_ALBUM_ARTIST).ifBlank { "Unknown artist" } }
    val album = text(metadata, MediaMetadata.METADATA_KEY_ALBUM)
    val duration = (metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0L).coerceAtLeast(0)
    val mediaId = text(metadata, MediaMetadata.METADATA_KEY_MEDIA_ID)
    val id = "${entry.id}|$mediaId|$title|$artist|$album|$duration"
    val now = SystemClock.elapsedRealtime()
    val playing = state?.state == PlaybackState.STATE_PLAYING
    val elapsed = if (playing && (state?.lastPositionUpdateTime ?: 0) > 0) (now - state!!.lastPositionUpdateTime).coerceAtLeast(0) else 0
    val rawPosition = ((state?.position ?: 0).coerceAtLeast(0) + elapsed * (state?.playbackSpeed ?: 0f)).toLong().coerceAtLeast(0)
    val position = if (duration > 0) rawPosition.coerceAtMost(duration) else rawPosition
    val bitmap = metadata?.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART)
      ?: metadata?.getBitmap(MediaMetadata.METADATA_KEY_ART)
      ?: metadata?.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON)
    val uri = text(metadata, MediaMetadata.METADATA_KEY_ALBUM_ART_URI).ifBlank {
      text(metadata, MediaMetadata.METADATA_KEY_ART_URI).ifBlank { text(metadata, MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI) }
    }
    // Binder may return a fresh Bitmap object on every read. Object identity is not an artwork key.
    val artKey = "$id|$uri|${bitmap != null}"
    requestArtwork(artKey, bitmap, uri)

    val queue = controller.queue.orEmpty()
    // Android 8 players frequently publish a queue without activeQueueItemId.
    // Anchor it from the current metadata so neighbors still render on older devices.
    var activeIndex = if (state?.activeQueueItemId != null && state.activeQueueItemId != -1L) {
      queue.indexOfFirst { it.queueId == state.activeQueueItemId }
    } else {
      -1
    }
    if (activeIndex < 0) {
      val currentTitle = title.trim()
      val currentArtist = artist.trim()
      activeIndex = queue.indexOfFirst { item ->
        val description = item.description
        val itemMediaId = description.mediaId?.toString().orEmpty()
        val itemTitle = description.title?.toString()?.trim().orEmpty()
        val itemArtist = description.subtitle?.toString()?.trim().orEmpty()
        (mediaId.isNotBlank() && itemMediaId == mediaId) ||
          (itemTitle == currentTitle && (currentArtist.isBlank() || itemArtist == currentArtist))
      }
    }
    val neighbors = if (activeIndex < 0) emptyList() else queue.withIndex().sortedBy { kotlin.math.abs(it.index - activeIndex) }.mapNotNull { (index, item) ->
      val offset = index - activeIndex
      if (offset == 0 || kotlin.math.abs(offset) > QUEUE_LOOKAHEAD) null else {
        val description = item.description
        val queueArtKey = "${entry.id}|queue:${item.queueId}|${description.mediaId}|${description.title}|${description.subtitle}|${description.iconUri}|${description.iconBitmap != null}"
        // Keep a deep metadata buffer, but only decode artwork near the visible cards.
        if (kotlin.math.abs(offset) <= ARTWORK_LOOKAHEAD)
          requestArtwork(queueArtKey, description.iconBitmap, description.iconUri?.toString().orEmpty())
        mapOf("id" to item.queueId.toString(), "title" to description.title?.toString().orEmpty(),
          "artist" to description.subtitle?.toString().orEmpty(), "offset" to offset, "artwork" to artworkCache[queueArtKey],
          "artworkPending" to pendingArt.contains(queueArtKey))
      }
    }
    return mapOf(
      "id" to id, "sessionId" to entry.id,
      "queueItemId" to state?.activeQueueItemId?.takeIf { it != -1L }?.toString(), "source" to runCatching {
        context.packageManager.getApplicationLabel(context.packageManager.getApplicationInfo(controller.packageName, 0)).toString()
      }.getOrDefault("Music app"),
      "title" to title, "artist" to artist, "album" to album,
      "artwork" to artworkCache[artKey], "artworkPending" to pendingArt.contains(artKey), "durationMs" to duration, "positionMs" to position,
      "playbackSpeed" to (state?.playbackSpeed ?: 0f), "playing" to playing,
      "buffering" to (state?.state in listOf(PlaybackState.STATE_BUFFERING, PlaybackState.STATE_CONNECTING)),
      "actions" to supportedActions(state?.actions ?: 0L), "neighbors" to neighbors
    )
  }

  private fun supportedActions(flags: Long): List<String> = buildList {
    if (flags and (PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PLAY_PAUSE) != 0L) add("play")
    if (flags and (PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE) != 0L) add("pause")
    if (flags and PlaybackState.ACTION_SKIP_TO_NEXT != 0L) add("skipNext")
    if (flags and PlaybackState.ACTION_SKIP_TO_PREVIOUS != 0L) add("skipPrevious")
    if (flags and PlaybackState.ACTION_SEEK_TO != 0L) add("seekTo")
  }

  fun control(action: String, sessionId: String, positionMs: Long): Boolean {
    if (!hasPermission() || !connected || selected != sessionId) return false
    val controller = entries[sessionId]?.controller ?: return false
    if (action !in supportedActions(controller.playbackState?.actions ?: 0)) return false
    return runCatching {
      with(controller.transportControls) {
        when (action) {
          "play" -> play()
          "pause" -> pause()
          "skipNext" -> skipToNext()
          "skipPrevious" -> skipToPrevious()
          "seekTo" -> {
            val duration = controller.metadata?.getLong(MediaMetadata.METADATA_KEY_DURATION) ?: 0
            if (duration <= 0) return false
            seekTo(positionMs.coerceIn(0, duration))
          }
          else -> return false
        }
      }
      true
    }.getOrDefault(false)
  }

  fun controlSessionMatches(sessionId: String): Boolean = connected && selected == sessionId

  fun volume(sessionId: String?): Map<String, Any?> {
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val info = if (sessionId == selected) entries[sessionId]?.controller?.playbackInfo else null
    val remote = info?.playbackType == MediaController.PlaybackInfo.PLAYBACK_TYPE_REMOTE
    val maximum = if (remote) info!!.maxVolume else audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
    val current = if (remote) info!!.currentVolume else audio.getStreamVolume(AudioManager.STREAM_MUSIC)
    val fixed = if (remote) info!!.volumeControl == VolumeProvider.VOLUME_CONTROL_FIXED else audio.isVolumeFixed
    val absolute = !fixed && (!remote || info!!.volumeControl == VolumeProvider.VOLUME_CONTROL_ABSOLUTE)
    return mapOf("level" to if (maximum > 0) current.toDouble() / maximum else 0.0,
      "adjustable" to (!fixed && maximum > 0), "absolute" to absolute,
      "remote" to remote, "sessionId" to sessionId)
  }

  fun changeVolume(sessionId: String?, level: Double?, direction: Int): Map<String, Any?> {
    require(sessionId == null || sessionId == selected) { "The music source changed. Try again." }
    val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    val controller = if (sessionId == selected) entries[sessionId]?.controller else null
    val info = controller?.playbackInfo
    if (info?.playbackType == MediaController.PlaybackInfo.PLAYBACK_TYPE_REMOTE) {
      if (info.volumeControl != VolumeProvider.VOLUME_CONTROL_FIXED) {
        if (level != null && info.volumeControl == VolumeProvider.VOLUME_CONTROL_ABSOLUTE)
          controller.setVolumeTo(kotlin.math.round(level.coerceIn(0.0, 1.0) * info.maxVolume).toInt(), 0)
        else if (level == null) controller.adjustVolume(direction.coerceIn(-1, 1), 0)
      }
    } else if (!audio.isVolumeFixed) {
      if (level != null) audio.setStreamVolume(AudioManager.STREAM_MUSIC,
        kotlin.math.round(level.coerceIn(0.0, 1.0) * audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)).toInt(), 0)
      else audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction.coerceIn(-1, 1), 0)
    }
    return volume(sessionId)
  }

  private fun requestArtwork(key: String, bitmap: Bitmap?, uri: String) {
    if (artworkCache.containsKey(key) || pendingArt.contains(key)) return
    if (bitmap == null && uri.isBlank()) return
    if (!artworkRetry.canRetry(key, SystemClock.elapsedRealtime())) return
    loadArtwork(key, bitmap, uri)
  }

  private fun loadArtwork(key: String, bitmap: Bitmap?, uriString: String) {
    val generation = artworkGeneration
    pendingArt.add(key)
    artworkWorker.execute {
      var owned: Bitmap? = null
      val result = runCatching {
        val uri = uriString.takeIf { it.isNotBlank() }?.let(Uri::parse)
        // Accept content/file resources; never issue arbitrary network requests from media metadata.
        if (bitmap == null && uri != null && uri.scheme in listOf("content", "file", "android.resource")) {
          val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
          context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
          val options = BitmapFactory.Options().apply {
            inSampleSize = 1
            while (bounds.outWidth / inSampleSize > 1024 || bounds.outHeight / inSampleSize > 1024) inSampleSize *= 2
          }
          owned = context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, options) }
        }
        val source = bitmap ?: owned ?: return@runCatching null
        val scale = minOf(1f, 1024f / maxOf(source.width, source.height))
        val resized = if (scale < 1) Bitmap.createScaledBitmap(source, (source.width * scale).toInt().coerceAtLeast(1), (source.height * scale).toInt().coerceAtLeast(1), true) else source
        val bytes = try {
          ByteArrayOutputStream().use { output ->
            check(resized.compress(Bitmap.CompressFormat.JPEG, 88, output))
            output.toByteArray()
          }
        } finally { if (resized !== source) resized.recycle() }
        // Identical queue and metadata artwork share one immutable URI and image-cache entry.
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
          .joinToString("") { "%02x".format(it) }
        val directory = File(context.cacheDir, "now-playing-art").apply { mkdirs() }
        val file = File(directory, "$digest.jpg")
        if (!file.exists()) {
          val temporary = File.createTempFile("pending-", ".jpg", directory)
          try {
            temporary.writeBytes(bytes)
            check(temporary.renameTo(file))
          } finally { temporary.delete() }
        }
        file.setLastModified(System.currentTimeMillis())
        FileProvider.getUriForFile(context, "${context.packageName}.nowplaying.artwork", file).toString()
      }.getOrNull()
      owned?.recycle()
      main.post {
        if (generation == artworkGeneration) {
          pendingArt.remove(key)
          if (result != null) {
            artworkCache[key] = result
            artworkRetry.succeeded(key)
          } else {
            // Retry even while paused; no playback or metadata event is required.
            val delay = artworkRetry.failed(key, SystemClock.elapsedRealtime())
            main.postDelayed(artworkRetryTask, delay)
          }
          scheduleEmission()
        }
      }
    }
  }

}
