package expo.modules.nowplaying

/** A missing provider can recover without its URI changing. Keep failures temporary. */
internal class ArtworkRetryPolicy {
  private data class Failure(val attempts: Int, val retryAt: Long)
  private val failures = object : LinkedHashMap<String, Failure>(16, .75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Failure>) = size > 96
  }

  fun canRetry(key: String, now: Long) = failures[key]?.let { now >= it.retryAt } ?: true

  fun failed(key: String, now: Long): Long {
    val attempts = ((failures[key]?.attempts ?: 0) + 1).coerceAtMost(5)
    val delay = minOf(30_000L, 2_000L shl (attempts - 1))
    failures[key] = Failure(attempts, now + delay)
    return delay
  }

  fun succeeded(key: String) { failures.remove(key) }
}
