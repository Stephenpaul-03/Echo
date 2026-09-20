package expo.modules.nowplaying

import org.junit.Assert.*
import org.junit.Test

class ArtworkRetryPolicyTest {
  @Test fun failureExpiresWithoutChangingTheArtworkUri() {
    val policy = ArtworkRetryPolicy()
    assertTrue(policy.canRetry("content://player/album/1", 100))
    assertEquals(2000L, policy.failed("content://player/album/1", 100))
    assertFalse(policy.canRetry("content://player/album/1", 2099))
    assertTrue(policy.canRetry("content://player/album/1", 2100))
  }

  @Test fun repeatedFailuresBackOffAndRemainRetryable() {
    val policy = ArtworkRetryPolicy()
    var now = 0L
    for (delay in listOf(2000L, 4000L, 8000L, 16000L, 30000L, 30000L)) {
      assertEquals(delay, policy.failed("album", now))
      assertFalse(policy.canRetry("album", now + delay - 1))
      now += delay
      assertTrue(policy.canRetry("album", now))
    }
  }

  @Test fun recoveringAnImageResetsItsBackoffWithoutAffectingOtherImages() {
    val policy = ArtworkRetryPolicy()
    policy.failed("one", 0)
    policy.failed("two", 0)
    policy.succeeded("one")
    assertTrue(policy.canRetry("one", 1))
    assertFalse(policy.canRetry("two", 1))
    assertEquals(2000L, policy.failed("one", 1))
  }
}
