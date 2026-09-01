package com.enat.app.data.auth

import android.app.Activity
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.Base64

class SessionIdTokenProviderTest {
    private val now: Instant = Instant.parse("2026-08-25T12:00:00Z")
    private val clock: Clock = Clock.fixed(now, ZoneOffset.UTC)
    private val json = Json { ignoreUnknownKeys = true }

    /** A structurally valid unsigned JWT whose payload carries only `exp`. */
    private fun tokenExpiringAt(expiry: Instant): String {
        val payload =
            Base64.getUrlEncoder().withoutPadding()
                .encodeToString("""{"exp":${expiry.epochSecond}}""".toByteArray())
        return "header.$payload.signature"
    }

    private fun provider(gateway: FakeSignInGateway): SessionIdTokenProvider =
        SessionIdTokenProvider(gateway, clock, json)

    @Test
    fun `mints a token and caches it while it stays fresh`() =
        runTest {
            val token = tokenExpiringAt(now.plusSeconds(3600))
            val gateway = FakeSignInGateway(mutableListOf(SignInOutcome.SignedIn(token)))
            val provider = provider(gateway)

            assertEquals(token, provider.idToken())
            assertEquals(token, provider.idToken())
            // One mint serves both calls — the second comes from the in-memory cache.
            assertEquals(1, gateway.silentSignInCalls)
        }

    @Test
    fun `re-mints when the cached token is inside the expiry slack`() =
        runTest {
            val nearlyExpired = tokenExpiringAt(now.plusSeconds(60))
            val fresh = tokenExpiringAt(now.plusSeconds(3600))
            val gateway =
                FakeSignInGateway(
                    mutableListOf(SignInOutcome.SignedIn(nearlyExpired), SignInOutcome.SignedIn(fresh)),
                )
            val provider = provider(gateway)

            assertEquals(nearlyExpired, provider.idToken())
            // 60s left is inside the 5-minute slack, so the cache must not be trusted.
            assertEquals(fresh, provider.idToken())
            assertEquals(2, gateway.silentSignInCalls)
        }

    @Test
    fun `returns null when minting fails and tries again next time`() =
        runTest {
            val fresh = tokenExpiringAt(now.plusSeconds(3600))
            val gateway =
                FakeSignInGateway(
                    mutableListOf(
                        SignInOutcome.Failed(IOException("no credential")),
                        SignInOutcome.SignedIn(fresh) as SignInOutcome,
                    ),
                )
            val provider = provider(gateway)

            assertNull(provider.idToken())
            // A failure is never cached — the next call mints successfully.
            assertEquals(fresh, provider.idToken())
        }

    @Test
    fun `invalidate drops the cached token`() =
        runTest {
            val first = tokenExpiringAt(now.plusSeconds(3600))
            val second = tokenExpiringAt(now.plusSeconds(7200))
            val gateway =
                FakeSignInGateway(mutableListOf(SignInOutcome.SignedIn(first), SignInOutcome.SignedIn(second)))
            val provider = provider(gateway)

            assertEquals(first, provider.idToken())
            provider.invalidate()
            assertEquals(second, provider.idToken())
            assertEquals(2, gateway.silentSignInCalls)
        }

    @Test
    fun `a far-future exp claim cannot pin the token past the one-hour cap`() =
        runTest {
            val mutableClock = MutableClock(now)
            val suspicious = tokenExpiringAt(now.plusSeconds(365L * 24 * 3600))
            val fresh = tokenExpiringAt(now.plusSeconds(400L * 24 * 3600))
            val gateway =
                FakeSignInGateway(
                    mutableListOf(SignInOutcome.SignedIn(suspicious), SignInOutcome.SignedIn(fresh)),
                )
            val provider = SessionIdTokenProvider(gateway, mutableClock, json)

            assertEquals(suspicious, provider.idToken())
            mutableClock.advance(Duration.ofHours(2))
            // Two hours later the clamped cache lifetime (1h) has passed — the
            // bogus exp claim must not keep the old token alive.
            assertEquals(fresh, provider.idToken())
            assertEquals(2, gateway.silentSignInCalls)
        }

    @Test
    fun `a token with an unreadable payload is used once but never cached`() =
        runTest {
            val fresh = tokenExpiringAt(now.plusSeconds(3600))
            val gateway =
                FakeSignInGateway(
                    mutableListOf(SignInOutcome.SignedIn("not-a-jwt"), SignInOutcome.SignedIn(fresh)),
                )
            val provider = provider(gateway)

            assertEquals("not-a-jwt", provider.idToken())
            assertEquals(fresh, provider.idToken())
            assertEquals(2, gateway.silentSignInCalls)
        }

    private class MutableClock(
        private var current: Instant,
    ) : Clock() {
        fun advance(duration: Duration) {
            current += duration
        }

        override fun instant(): Instant = current

        override fun getZone(): ZoneId = ZoneOffset.UTC

        override fun withZone(zone: ZoneId): Clock = this
    }

    private class FakeSignInGateway(
        private val outcomes: MutableList<SignInOutcome>,
    ) : GoogleSignInGateway {
        var silentSignInCalls = 0

        override suspend fun signIn(activity: Activity): SignInOutcome = error("not used")

        override suspend fun silentSignIn(): SignInOutcome {
            silentSignInCalls += 1
            return outcomes.removeAt(0)
        }
    }
}
