package expo.modules.nowplaying

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.Cursor
import android.media.browse.MediaBrowser
import android.media.session.MediaController
import android.media.session.MediaSession
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.core.content.FileProvider
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors

/** Poweramp's official intent, provider, and media-browser integration. */
internal class PowerAmpDataSource : NowPlayingDataSource {
  companion object {
    private const val PACKAGE = "com.maxmpz.audioplayer"
    private const val API_COMMAND = "com.maxmpz.audioplayer.API_COMMAND"
    private const val API_RECEIVER = "com.maxmpz.audioplayer.player.PowerampAPIReceiver"
    private const val BROWSER_SERVICE = "com.maxmpz.audioplayer.data.external.BrowserService"
    private const val TRACK_CHANGED = "com.maxmpz.audioplayer.TRACK_CHANGED"
    private const val STATUS_CHANGED = "com.maxmpz.audioplayer.STATUS_CHANGED"
    private const val POSITION_SYNC = "com.maxmpz.audioplayer.TPOS_SYNC"
    private const val TRACK = "track"
    private const val ID = "id"
    private const val REAL_ID = "realId"
    private const val TITLE = "title"
    private const val ARTIST = "artist"
    private const val ALBUM = "album"
    private const val DURATION = "dur"
    private const val DURATION_MS = "durMs"
    private const val POSITION = "pos"
    private const val CAT_URI = "catUri"
    private const val POS_IN_LIST = "posInList"
    private const val STATE = "state"
    private const val PAUSED = "paused"
    private const val AA_AUTHORITY = "com.maxmpz.audioplayer.aa"
    private const val DATA_AUTHORITY = "com.maxmpz.audioplayer.data"
    private const val QUEUE_LOOKAHEAD = 18
    private const val ARTWORK_LOOKAHEAD = 4
  }

  private val main = Handler(Looper.getMainLooper())
  private val artworkWorker = Executors.newFixedThreadPool(2)
  private val artworkCache = mutableMapOf<String, String>()
  private val pendingArtwork = mutableSetOf<String>()
  private var context: Context? = null
  private var listener: ((String, Map<String, Any?>) -> Unit)? = null
  private var receiver: BroadcastReceiver? = null
  private var mediaBrowser: MediaBrowser? = null
  private var mediaController: MediaController? = null
  private var registered = false
  private var current: Map<String, Any?>? = null
  private var currentTrackBundle: Bundle? = null
  private var pausedState = true
  private var lastPositionMs = 0L
  private var lastBroadcastAt = 0L
  private var queuedEmission: Runnable? = null

  override fun start(context: Context, listener: (String, Map<String, Any?>) -> Unit) {
    if (registered) return
    this.context = context.applicationContext
    this.listener = listener
    if (!isInstalled()) return
    val filter = IntentFilter().apply {
      addAction(TRACK_CHANGED)
      addAction(STATUS_CHANGED)
      addAction(POSITION_SYNC)
    }
    receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
          TRACK_CHANGED -> update(intent, true)
          STATUS_CHANGED -> update(intent, false)
          POSITION_SYNC -> updatePosition(intent)
        }
      }
    }
    try {
      // Poweramp grants access to its data/art providers to callers explicitly on Android 8+.
      requestDataPermission()
      if (Build.VERSION.SDK_INT >= 33) {
        this.context!!.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        @Suppress("DEPRECATION")
        this.context!!.registerReceiver(receiver, filter)
      }
      registered = true
      connectMediaBrowser()
      // Sticky API broadcasts give us the current track without waiting for playback to change.
      readSticky()
    } catch (_: Throwable) {
      registered = false
      receiver = null
    }
  }

  override fun stop() {
    queuedEmission?.let(main::removeCallbacks)
    queuedEmission = null
    if (registered) runCatching { context?.unregisterReceiver(receiver) }
    runCatching { mediaController?.unregisterCallback(mediaCallback) }
    runCatching { mediaBrowser?.disconnect() }
    mediaController = null
    mediaBrowser = null
    registered = false
    receiver = null
    listener = null
    context = null
    current = null
    currentTrackBundle = null
    pendingArtwork.clear()
  }

  override fun refresh(): Map<String, Any?>? {
    if (!isInstalled()) return null
    if (current == null) readSticky()
    else currentTrackBundle?.let { current = buildSnapshot(it, pausedState) }
    return mapOf("permission" to true, "connected" to (current != null), "track" to current)
  }

  override fun ownsSession(sessionId: String) = sessionId == "poweramp" && current != null

  override fun control(action: String, sessionId: String, positionMs: Long): Boolean {
    if (!ownsSession(sessionId)) return false
    // Integer commands work on old and current Poweramp builds. String command
    // names were only added in build 867.
    val command = when (action) {
      "play" -> 3
      "pause" -> 2
      "skipNext" -> 4
      "skipPrevious" -> 5
      "seekTo" -> 15
      else -> return false
    }
    val appContext = context ?: return false
    return runCatching {
      val intent = Intent(API_COMMAND)
        .setComponent(ComponentName(PACKAGE, API_RECEIVER))
        .putExtra("cmd", command)
      if (action == "seekTo") intent.putExtra(POSITION, (positionMs / 1000L).toInt())
      appContext.sendBroadcast(intent)
      if (action == "seekTo") {
        lastPositionMs = positionMs.coerceAtLeast(0)
        current = current?.toMutableMap()?.apply { put("positionMs", lastPositionMs) }
        scheduleEmit()
        main.postDelayed({ requestPositionSync() }, 200)
      }
      true
    }.getOrDefault(false)
  }

  private fun isInstalled(): Boolean = runCatching {
    context?.packageManager?.getApplicationInfo(PACKAGE, 0)
    true
  }.getOrDefault(false)

  private fun requestDataPermission() {
    val appContext = context ?: return
    runCatching {
      appContext.sendBroadcast(
        Intent("com.maxmpz.audioplayer.ACTION_ASK_FOR_DATA_PERMISSION")
          .setComponent(ComponentName(PACKAGE, API_RECEIVER))
          .putExtra("package", appContext.packageName)
      )
    }
  }

  private fun readSticky() {
    val appContext = context ?: return
    val status = runCatching {
      @Suppress("DEPRECATION")
      appContext.registerReceiver(null, IntentFilter(STATUS_CHANGED))
    }.getOrNull()
    val track = runCatching {
      @Suppress("DEPRECATION")
      appContext.registerReceiver(null, IntentFilter(TRACK_CHANGED))
    }.getOrNull()
    if (track != null) update(track, true) else if (status != null) update(status, false)
  }

  private fun requestPositionSync() {
    val appContext = context ?: return
    runCatching {
      appContext.sendBroadcast(
        Intent(API_COMMAND)
          .setComponent(ComponentName(PACKAGE, API_RECEIVER))
          .putExtra("cmd", 16)
      )
    }
  }

  private fun updatePosition(intent: Intent) {
    if (!intent.hasExtra(POSITION)) return
    lastPositionMs = intent.getIntExtra(POSITION, 0).coerceAtLeast(0) * 1000L
    current = current?.toMutableMap()?.apply { put("positionMs", lastPositionMs) }
    if (current != null) scheduleEmit()
  }

  private fun update(intent: Intent, trackChanged: Boolean) {
    lastBroadcastAt = SystemClock.elapsedRealtime()
    val status = intent.getIntExtra(STATE, Int.MIN_VALUE)
    if (!trackChanged) {
      pausedState = intent.getBooleanExtra(PAUSED, status != 1)
      if (intent.hasExtra(POSITION)) lastPositionMs = intent.getIntExtra(POSITION, 0).coerceAtLeast(0) * 1000L
      if (status == 0) {
        current = null
        listener?.invoke("onNoSession", emptyMap())
        return
      }
      current = current?.toMutableMap()?.apply {
        put("positionMs", lastPositionMs)
        put("playing", !pausedState)
        put("playbackSpeed", if (pausedState) 0f else 1f)
      }
      if (current != null) scheduleEmit()
      return
    }
    val bundle = intent.getBundleExtra(TRACK) ?: intent.extras ?: return
    if (intent.hasExtra(PAUSED)) pausedState = intent.getBooleanExtra(PAUSED, pausedState)
    val previousBundle = currentTrackBundle
    val sameTrack = previousBundle != null && trackIdentity(previousBundle) == trackIdentity(bundle)
    if (intent.hasExtra(POSITION)) {
      lastPositionMs = intent.getIntExtra(POSITION, 0).coerceAtLeast(0) * 1000L
    } else if (!sameTrack) {
      // A track broadcast can be emitted for a metadata/status refresh (including
      // volume changes) without carrying a position. Keep progress for the same
      // track; only a genuinely new track starts at zero.
      lastPositionMs = 0L
    }
    currentTrackBundle = Bundle(bundle)
    val next = buildSnapshot(bundle, pausedState)
    if (next != null) {
      current = next
      scheduleEmit()
    }
  }

  private fun buildSnapshot(bundle: Bundle, paused: Boolean): Map<String, Any?>? {
    val title = bundle.getString(TITLE).orEmpty().ifBlank { "Unknown track" }
    val artist = bundle.getString(ARTIST).orEmpty().ifBlank { "Unknown artist" }
    val album = bundle.getString(ALBUM).orEmpty()
    val id = longExtra(bundle, ID, longExtra(bundle, REAL_ID, 0L)).toString()
    if (id == "0" && title == "Unknown track") return null
    val durationMs = when {
      bundle.containsKey(DURATION_MS) -> longExtra(bundle, DURATION_MS, 0L).coerceAtLeast(0)
      else -> longExtra(bundle, DURATION, 0L).coerceAtLeast(0) * 1000L
    }
    val positionMs = lastPositionMs
    val realId = longExtra(bundle, REAL_ID, longExtra(bundle, ID, 0L))
    val artworkKey = "file:$realId"
    val artwork = artworkFor(realId)
    val neighbors = queryPlayingList(bundle, realId, id)
    return applyMediaQueue(mapOf(
      "id" to "poweramp:$id", "sessionId" to "poweramp", "queueItemId" to id,
      "source" to "Poweramp", "title" to title, "artist" to artist, "album" to album,
      "artwork" to artwork, "artworkPending" to (realId > 0 && artwork == null), "artworkKey" to artworkKey,
      "durationMs" to durationMs, "positionMs" to positionMs,
      "playbackSpeed" to if (paused) 0f else 1f, "playing" to !paused, "buffering" to false,
      "actions" to listOf("play", "pause", "skipNext", "skipPrevious", "seekTo"),
      "neighbors" to neighbors
    ))
  }

  private fun longExtra(bundle: Bundle, key: String, default: Long): Long =
    runCatching { (bundle.get(key) as? Number)?.toLong() ?: default }.getOrDefault(default)

  private fun trackIdentity(bundle: Bundle): String =
    "${longExtra(bundle, ID, longExtra(bundle, REAL_ID, 0L))}|" +
      "${longExtra(bundle, REAL_ID, longExtra(bundle, ID, 0L))}|" +
      "${bundle.getString(TITLE).orEmpty()}|${bundle.getString(ARTIST).orEmpty()}|${bundle.getString(ALBUM).orEmpty()}"

  private fun queryPlayingList(bundle: Bundle, realId: Long, trackId: String): List<Map<String, Any?>> {
    val appContext = context ?: return emptyList()
    if (realId <= 0 && trackId == "0") return emptyList()
    val categoryUri = when (val value = bundle.get(CAT_URI)) {
      is Uri -> value
      is String -> runCatching { Uri.parse(value) }.getOrNull()
      else -> null
    }?.takeIf { it.scheme == "content" && it.authority == DATA_AUTHORITY }
    val positionInList = (bundle.get(POS_IN_LIST) as? Number)?.toInt() ?: -1

    // catUri is the list Poweramp is actually playing (album, playlist, folder,
    // all songs, etc). /queue only represents tracks explicitly added to Queue.
    val categoryFilesUri = categoryUri?.buildUpon()?.appendPath("files")?.build()
    val candidates = listOfNotNull(categoryFilesUri, categoryUri, Uri.parse("content://$DATA_AUTHORITY/queue")).distinct()
    for (uri in candidates) {
      val rows = queryList(uri, realId, trackId, positionInList)
      if (rows.isNotEmpty()) return rows
    }
    return emptyList()
  }

  private fun queryList(uri: Uri, realId: Long, trackId: String, positionInList: Int): List<Map<String, Any?>> {
    val appContext = context ?: return emptyList()
    return runCatching {
      // A null projection works across Poweramp builds whose qualified aliases differ.
      appContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
        if (cursor.count <= 1) return@use emptyList()
        val idColumn = column(cursor, "queue._id", "playlist_entries._id", "folder_files._id", "_id")
        val fileIdColumn = column(cursor, "queue.folder_file_id", "playlist_entries.folder_file_id", "folder_file_id", "folder_files._id")
        val titleColumn = column(cursor, "folder_files.title_tag", "title_tag", "title")
        // Reject album/artist/category rows. catUri identifies a category on
        // some builds; appending /files above resolves its actual tracks.
        if (fileIdColumn < 0 && column(cursor, "folder_files.path", "path", "duration", "dur", "duration_ms") < 0) return@use emptyList()
        val active = findActivePosition(cursor, idColumn, fileIdColumn, realId, trackId, positionInList)
        if (active < 0) return@use emptyList()

        val artistColumn = column(cursor, "folder_files.artist_tag", "artist_tag", "artist")
        val albumColumn = column(cursor, "folder_files.album_tag", "album_tag", "album")
        val start = (active - QUEUE_LOOKAHEAD).coerceAtLeast(0)
        val end = (active + QUEUE_LOOKAHEAD).coerceAtMost(cursor.count - 1)
        (start..end).mapNotNull { index ->
          if (index == active || !cursor.moveToPosition(index)) return@mapNotNull null
          val itemId = if (idColumn >= 0) cursor.getLong(idColumn) else 0L
          val fileId = if (fileIdColumn >= 0) cursor.getLong(fileIdColumn) else itemId
          val metadata = if (titleColumn < 0 || artistColumn < 0) queryFileMetadata(fileId) else emptyMap()
          mapOf(
            "id" to (if (itemId > 0) itemId else fileId).toString(),
            "title" to cursorText(cursor, titleColumn, metadata["title"] ?: "Unknown track"),
            "artist" to cursorText(cursor, artistColumn, metadata["artist"] ?: "Unknown artist"),
            "album" to cursorText(cursor, albumColumn, metadata["album"] ?: ""),
            "artwork" to if (kotlin.math.abs(index - active) <= ARTWORK_LOOKAHEAD) artworkFor(fileId) else null,
            "artworkPending" to (kotlin.math.abs(index - active) <= ARTWORK_LOOKAHEAD && fileId > 0 && artworkCache["file:$fileId"] == null),
            "artworkKey" to "file:$fileId",
            "offset" to (index - active)
          )
        }
      }.orEmpty()
    }.getOrDefault(emptyList())
  }

  private fun findActivePosition(cursor: Cursor, idColumn: Int, fileIdColumn: Int, realId: Long, trackId: String, hinted: Int): Int {
    fun matches(): Boolean {
      val itemId = if (idColumn >= 0) cursor.getLong(idColumn) else 0L
      val fileId = if (fileIdColumn >= 0) cursor.getLong(fileIdColumn) else itemId
      return (realId > 0 && fileId == realId) || itemId.toString() == trackId
    }
    if (hinted in 0 until cursor.count && cursor.moveToPosition(hinted) && matches()) return hinted
    cursor.moveToPosition(-1)
    while (cursor.moveToNext()) if (matches()) return cursor.position
    // Some Poweramp builds omit stable IDs from category projections. Its own
    // posInList is still authoritative when it is within the returned list.
    return hinted.takeIf { it in 0 until cursor.count } ?: -1
  }

  private fun column(cursor: Cursor, vararg names: String): Int =
    names.firstNotNullOfOrNull { name -> cursor.getColumnIndex(name).takeIf { it >= 0 } } ?: -1

  private fun cursorText(cursor: Cursor, column: Int, fallback: String): String =
    if (column >= 0) cursor.getString(column)?.trim()?.ifBlank { fallback } ?: fallback else fallback

  private fun queryFileMetadata(fileId: Long): Map<String, String> {
    if (fileId <= 0) return emptyMap()
    val uri = Uri.parse("content://$DATA_AUTHORITY/files/$fileId")
    return runCatching {
      context?.contentResolver?.query(uri, null, null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) return@use emptyMap()
        fun value(name: String): String? {
          val index = cursor.getColumnIndex(name)
          return if (index >= 0) cursor.getString(index)?.trim()?.ifBlank { null } else null
        }
        mapOf("title" to (value("title_tag") ?: "Unknown track"), "artist" to (value("artist_tag") ?: "Unknown artist"), "album" to (value("album_tag") ?: ""))
      }.orEmpty()
    }.getOrDefault(emptyMap())
  }

  private fun artworkFor(fileId: Long): String? {
    if (fileId <= 0) return null
    val source = Uri.Builder().scheme("content").authority(AA_AUTHORITY)
      .appendPath("files").appendPath(fileId.toString()).appendQueryParameter("hd", "true").build()
    return cacheArtwork("file:$fileId", source)
  }

  private fun cacheArtwork(key: String, source: Uri?): String? {
    if (source == null) return null
    artworkCache[key]?.let { return it }
    if (!pendingArtwork.add(key)) return null
    val appContext = context
    if (appContext == null) {
      pendingArtwork.remove(key)
      return null
    }
    artworkWorker.execute {
      val cached = runCatching {
        val bytes = appContext.contentResolver.openInputStream(source)?.use { it.readBytes() }
          ?.takeIf { it.isNotEmpty() } ?: return@runCatching null
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        val extension = when {
          bytes.size >= 8 && bytes[0] == 0x89.toByte() && bytes.copyOfRange(1, 4).contentEquals("PNG".toByteArray()) -> ".png"
          bytes.size >= 12 && bytes.copyOfRange(0, 4).contentEquals("RIFF".toByteArray()) && bytes.copyOfRange(8, 12).contentEquals("WEBP".toByteArray()) -> ".webp"
          else -> ".jpg"
        }
        val directory = File(appContext.cacheDir, "poweramp-art").apply { mkdirs() }
        val target = File(directory, "$digest$extension")
        if (!target.exists()) {
          val temporary = File.createTempFile("pending-", extension, directory)
          try {
            temporary.writeBytes(bytes)
            check(temporary.renameTo(target))
          } finally { temporary.delete() }
        }
        FileProvider.getUriForFile(appContext, "${appContext.packageName}.nowplaying.artwork", target).toString()
      }.getOrNull()
      main.post {
        pendingArtwork.remove(key)
        if (cached != null) {
          artworkCache[key] = cached
          applyCachedArtwork(key, cached)
        }
      }
    }
    return null
  }

  private fun applyCachedArtwork(key: String, uri: String) {
    val snapshot = current ?: return
    val updated = snapshot.toMutableMap()
    if (snapshot["artworkKey"] == key) {
      updated["artwork"] = uri
      updated["artworkPending"] = false
    }
    @Suppress("UNCHECKED_CAST")
    val neighbors = snapshot["neighbors"] as? List<Map<String, Any?>>
    updated["neighbors"] = neighbors?.map { cover ->
      if (cover["artworkKey"] == key)
        cover + mapOf("artwork" to uri, "artworkPending" to false)
      else cover
    }.orEmpty()
    current = updated
    scheduleEmit()
  }

  private val mediaCallback = object : MediaController.Callback() {
    override fun onQueueChanged(queue: MutableList<MediaSession.QueueItem>?) = refreshMediaQueue()
    override fun onPlaybackStateChanged(state: android.media.session.PlaybackState?) = refreshMediaQueue()
  }

  private fun connectMediaBrowser() {
    val appContext = context ?: return
    if (mediaBrowser != null) return
    mediaBrowser = MediaBrowser(appContext, ComponentName(PACKAGE, BROWSER_SERVICE), object : MediaBrowser.ConnectionCallback() {
      override fun onConnected() {
        val browser = mediaBrowser ?: return
        mediaController = MediaController(appContext, browser.sessionToken).also { it.registerCallback(mediaCallback, main) }
        refreshMediaQueue()
      }
      override fun onConnectionSuspended() { mediaController = null }
      override fun onConnectionFailed() { mediaController = null }
    }, null).also { runCatching { it.connect() } }
  }

  private fun refreshMediaQueue() {
    current = current?.let(::applyMediaQueue)
    if (current != null) scheduleEmit()
  }

  private fun applyMediaQueue(snapshot: Map<String, Any?>): Map<String, Any?> {
    val controller = mediaController ?: return snapshot
    val queue = controller.queue.orEmpty()
    val activeId = controller.playbackState?.activeQueueItemId ?: return snapshot
    val active = queue.indexOfFirst { it.queueId == activeId }
    if (active < 0 || queue.size <= 1) return snapshot
    val neighbors = ((active - QUEUE_LOOKAHEAD).coerceAtLeast(0)..(active + QUEUE_LOOKAHEAD).coerceAtMost(queue.lastIndex)).mapNotNull { index ->
      if (index == active) return@mapNotNull null
      val item = queue[index]
      val description = item.description
      val artworkKey = "browser:${item.queueId}:${description.iconUri}"
      mapOf(
        "id" to item.queueId.toString(),
        "title" to (description.title?.toString()?.ifBlank { "Unknown track" } ?: "Unknown track"),
        "artist" to (description.subtitle?.toString()?.ifBlank { "Unknown artist" } ?: "Unknown artist"),
        "album" to (description.description?.toString() ?: ""),
        "artwork" to if (kotlin.math.abs(index - active) <= ARTWORK_LOOKAHEAD) cacheArtwork(artworkKey, description.iconUri) else null,
        "artworkPending" to (kotlin.math.abs(index - active) <= ARTWORK_LOOKAHEAD && description.iconUri != null && artworkCache[artworkKey] == null),
        "artworkKey" to artworkKey,
        "offset" to (index - active)
      )
    }
    return snapshot + mapOf("queueItemId" to activeId.toString(), "neighbors" to neighbors)
  }

  private fun scheduleEmit() {
    queuedEmission?.let(main::removeCallbacks)
    queuedEmission = Runnable { current?.let { listener?.invoke("onTrackUpdate", it) } }
    main.postDelayed(queuedEmission!!, 150)
  }
}
