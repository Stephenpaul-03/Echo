package expo.modules.nowplaying

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionPolicyTest {
  @Test fun playingWinsOverNewerPausedSession() {
    assertEquals("music", SessionPolicy.select(listOf(SessionCandidate("podcast", 2, 200), SessionCandidate("music", 3, 100)), "podcast"))
  }
  @Test fun newestPlayingSessionWins() {
    assertEquals("new", SessionPolicy.select(listOf(SessionCandidate("old", 3, 100), SessionCandidate("new", 3, 200)), "old"))
  }
  @Test fun pausedFallbackRetainsMostRecent() {
    assertEquals("recent", SessionPolicy.select(listOf(SessionCandidate("old", 2, 10), SessionCandidate("recent", 2, 20)), null))
  }
  @Test fun tiesKeepCurrentSession() {
    assertEquals("a", SessionPolicy.select(listOf(SessionCandidate("a", 3, 10), SessionCandidate("z", 3, 10)), "a"))
  }
  @Test fun ignoresStoppedAndErrorSessions() {
    assertNull(SessionPolicy.select(listOf(SessionCandidate("stopped", 1, 99), SessionCandidate("error", 7, 100)), null))
  }
  @Test fun bufferingBeatsPausedButNotPlaying() {
    assertEquals("buffering", SessionPolicy.select(listOf(SessionCandidate("paused", 2, 99), SessionCandidate("buffering", 6, 10)), null))
    assertEquals("playing", SessionPolicy.select(listOf(SessionCandidate("playing", 3, 1), SessionCandidate("buffering", 6, 10)), null))
  }
}
