package com.enat.app.data.auth

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Supplies the Google ID token every authenticated /v1/ request carries.
 * Null means "signed out": no credential could be minted, and the caller must
 * route back to the setup flow's sign-in.
 */
interface IdTokenProvider {
    suspend fun idToken(): String?

    /** Drops the cached token (e.g. after the server answers 401 with it). */
    fun invalidate()
}

/**
 * In-memory-only token cache (TICKET-204's app-wide auth plumbing, the TICKET-202
 * follow-up). Tokens are minted silently via Credential Manager, kept only in
 * process memory — never persisted, never logged — and re-minted once the `exp`
 * claim comes within [EXPIRY_SLACK] of now.
 */
@Singleton
class SessionIdTokenProvider
    @Inject
    constructor(
        private val signInGateway: GoogleSignInGateway,
        private val clock: Clock,
        private val json: Json,
    ) : IdTokenProvider {
        private val mutex = Mutex()
        private var cachedToken: String? = null
        private var cachedExpiry: Instant = Instant.EPOCH

        override suspend fun idToken(): String? =
            mutex.withLock {
                val existing = cachedToken
                if (existing != null && clock.instant().isBefore(cachedExpiry.minus(EXPIRY_SLACK))) {
                    return existing
                }
                when (val outcome = signInGateway.silentSignIn()) {
                    is SignInOutcome.SignedIn -> {
                        cachedToken = outcome.idToken
                        cachedExpiry = expiryOf(outcome.idToken)
                        outcome.idToken
                    }
                    // Cancelled cannot happen without UI; either way there is no token.
                    SignInOutcome.Cancelled, is SignInOutcome.Failed -> {
                        cachedToken = null
                        null
                    }
                }
            }

        override fun invalidate() {
            // Plain assignment: invalidate must not block a network thread on the
            // mutex, and a racing mint simply repopulates the cache with a fresh token.
            cachedToken = null
        }

        /**
         * The `exp` claim of the (already Google-signed) token — read here only to
         * schedule re-minting, never as a security check; the backend verifies the
         * signature. Unparseable tokens get an already-past expiry: used once, never cached.
         */
        private fun expiryOf(idToken: String): Instant {
            val payload = idToken.split(".").getOrNull(1) ?: return Instant.EPOCH
            return try {
                val claims = Base64.getUrlDecoder().decode(payload).decodeToString()
                val exp = json.parseToJsonElement(claims).jsonObject["exp"]?.jsonPrimitive?.longOrNull
                if (exp != null) Instant.ofEpochSecond(exp) else Instant.EPOCH
            } catch (notBase64: IllegalArgumentException) {
                Instant.EPOCH
            } catch (notJson: SerializationException) {
                Instant.EPOCH
            }
        }

        private companion object {
            /** Re-mint while the token still has 5 minutes left, so an in-flight request never expires. */
            val EXPIRY_SLACK: Duration = Duration.ofMinutes(5)
        }
    }
