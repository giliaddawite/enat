package com.enat.app.data.verse

import com.enat.app.data.auth.SignedOutException
import com.enat.app.data.db.VerseDao
import com.enat.app.data.db.VerseEntity
import kotlinx.serialization.SerializationException
import java.io.IOException
import java.net.HttpURLConnection
import javax.inject.Inject

/**
 * Every way a verse sync can end, as a value — the screen branches on these, never
 * on exceptions (same shape as [com.enat.app.data.digest.DigestSyncResult]). The
 * endpoint never 404s and has no Gmail dependency, so the digest's NoDigestYet and
 * 409 cases have no counterpart here.
 */
sealed interface VerseSyncResult {
    data class Success(
        val verse: Verse,
    ) : VerseSyncResult

    /** 304: the cached copy is already current. */
    data object NotModified : VerseSyncResult

    /** No credential could be minted, or the server rejected the token — back to setup. */
    data object SignedOut : VerseSyncResult

    /** Connectivity failure — the cache (if any) is all there is right now. */
    data object Offline : VerseSyncResult

    /** 5xx and everything unrecognized — generic retry. */
    data object Failed : VerseSyncResult
}

interface VerseRepository {
    /** The Room cache, instantly and without network — the offline-first read path. */
    suspend fun cachedVerse(): Verse?

    /** `GET /v1/verse/today` with If-None-Match revalidation; persists a 200 into the cache. */
    suspend fun fetchToday(): VerseSyncResult
}

class NetworkVerseRepository
    @Inject
    constructor(
        private val api: VerseApi,
        private val dao: VerseDao,
    ) : VerseRepository {
        override suspend fun cachedVerse(): Verse? = dao.verse()?.toDomain()

        override suspend fun fetchToday(): VerseSyncResult {
            val response =
                try {
                    api.getVerseToday(ifNoneMatch = dao.verse()?.etag)
                } catch (signedOut: SignedOutException) {
                    return VerseSyncResult.SignedOut
                } catch (unreachable: IOException) {
                    // Offline or the server is down — the cache carries the screen.
                    return VerseSyncResult.Offline
                } catch (malformed: SerializationException) {
                    // A body that isn't the contract is a server problem, not a
                    // crash: same retryable answer as any other bad response.
                    return VerseSyncResult.Failed
                }
            val body = response.body()
            if (response.isSuccessful && body != null) {
                val verse = body.toDomain()
                persist(verse, etag = headerSafe(response.headers()["ETag"]))
                return VerseSyncResult.Success(verse)
            }
            return when (response.code()) {
                HttpURLConnection.HTTP_NOT_MODIFIED -> VerseSyncResult.NotModified
                // 401s deliberately leak no detail; the status alone means the session is dead.
                HttpURLConnection.HTTP_UNAUTHORIZED -> VerseSyncResult.SignedOut
                else -> VerseSyncResult.Failed
            }
        }

        private suspend fun persist(
            verse: Verse,
            etag: String?,
        ) {
            dao.save(
                VerseEntity(
                    date = verse.date,
                    reference = verse.reference,
                    referenceAm = verse.referenceAm,
                    textEn = verse.textEn,
                    textAm = verse.textAm,
                    etag = etag,
                ),
            )
        }

        /**
         * OkHttp refuses request-header values outside printable ASCII with an
         * IllegalArgumentException — which no IOException catch sees, and which a
         * persisted hostile ETag would rethrow on every later revalidation: a
         * sticky crash. Validate before persisting; a dropped ETag only makes the
         * next request unconditional.
         */
        private fun headerSafe(etag: String?): String? = etag?.takeIf { value -> value.all { it in ' '..'~' } }

        private fun VerseEntity.toDomain(): Verse =
            Verse(
                date = date,
                reference = reference,
                referenceAm = referenceAm,
                textEn = textEn,
                textAm = textAm,
            )
    }
