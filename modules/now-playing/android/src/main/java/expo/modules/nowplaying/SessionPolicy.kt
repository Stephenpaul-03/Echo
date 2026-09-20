package expo.modules.nowplaying

/** Kept independent of Android so competing-session behavior is unit-testable. */
internal data class SessionCandidate(val id: String, val state: Int, val changedAt: Long)

internal object SessionPolicy {
  fun select(candidates: List<SessionCandidate>, current: String?): String? = candidates
    .filter { it.state in listOf(2, 3, 6, 8) } // paused, playing, buffering, connecting
    .maxWithOrNull(compareBy<SessionCandidate>(
      { when (it.state) { 3 -> 3; 6, 8 -> 2; else -> 1 } },
      { it.changedAt },
      { if (it.id == current) 1 else 0 },
      { it.id }
    ))?.id
}
