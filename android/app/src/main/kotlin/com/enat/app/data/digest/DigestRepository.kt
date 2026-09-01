package com.enat.app.data.digest

import com.enat.app.data.auth.ApiErrorCode
import com.enat.app.data.auth.SignedOutException
import com.enat.app.data.auth.apiErrorCode
import com.enat.app.data.db.DigestDao
import com.enat.app.data.db.DigestEntity
import com.enat.app.data.db.DigestItemEntity
import kotlinx.serialization.json.Json
import retrofit2.Response
import java.io.IOException
import java.net.HttpURLConnection
import javax.inject.Inject

/** Every way a digest sync can end, as a value — screens branch on these, never on exceptions. */
sealed interface DigestSyncResult {
    data class Success(
        val digest: Digest,
    ) : DigestSyncResult

    /** 304: the cached copy is already current. */
    data object NotModified : DigestSyncResult

    /** 404 from the read path: nothing generated today yet — fall back to [DigestRepository.regenerate]. */
    data object NoDigestYet : DigestSyncResult

    /** 409 gmail_reconnect_required: the stored grant was revoked — show ReconnectCard. */
    data object GmailReconnectRequired : DigestSyncResult

    /** 409 gmail_not_connected: consent never happened on this account — back to setup. */
    data object GmailNotConnected : DigestSyncResult

    /** No credential could be minted, or the server rejected the token — back to setup. */
    data object SignedOut : DigestSyncResult

    /** Connectivity failure — the cache (if any) is all there is right now. */
    data object Offline : DigestSyncResult

    /** 5xx and everything unrecognized — generic retry. */
    data object Failed : DigestSyncResult
}

interface DigestRepository {
    /** The Room cache, instantly and without network — the offline-first read path. */
    suspend fun cachedDigest(): Digest?

    /** One cached email by id, for the detail screen. */
    suspend fun cachedItem(messageId: String): DigestItem?

    /** `GET /v1/digest` with If-None-Match revalidation; persists a 200 into the cache. */
    suspend fun fetchLatest(): DigestSyncResult

    /** `POST /v1/digest/generate` (on-demand generation); persists a 200 into the cache. */
    suspend fun regenerate(): DigestSyncResult
}

class NetworkDigestRepository
    @Inject
    constructor(
        private val api: DigestApi,
        private val dao: DigestDao,
        private val json: Json,
    ) : DigestRepository {
        override suspend fun cachedDigest(): Digest? {
            val header = dao.digest() ?: return null
            val items = dao.items()
            val sections =
                items
                    .groupBy { it.sectionOrder }
                    .toSortedMap()
                    .values
                    .map { sectionItems ->
                        DigestSection(
                            category = EmailCategory.fromWireId(sectionItems.first().category),
                            items = sectionItems.map { it.toDomain() },
                        )
                    }
            return Digest(
                date = header.date,
                generatedAt = header.generatedAt,
                emailCount = header.emailCount,
                sections = sections,
            )
        }

        override suspend fun cachedItem(messageId: String): DigestItem? = dao.item(messageId)?.toDomain()

        override suspend fun fetchLatest(): DigestSyncResult = sync { api.getDigest(ifNoneMatch = dao.digest()?.etag) }

        override suspend fun regenerate(): DigestSyncResult = sync { api.generateDigest() }

        private suspend fun sync(call: suspend () -> Response<DigestResponse>): DigestSyncResult {
            val response =
                try {
                    call()
                } catch (signedOut: SignedOutException) {
                    return DigestSyncResult.SignedOut
                } catch (unreachable: IOException) {
                    // Offline or the server is down — the cache carries the screen.
                    return DigestSyncResult.Offline
                }
            val body = response.body()
            if (response.isSuccessful && body != null) {
                val digest = body.toDomain()
                persist(digest, etag = response.headers()["ETag"])
                return DigestSyncResult.Success(digest)
            }
            return when (response.code()) {
                HttpURLConnection.HTTP_NOT_MODIFIED -> DigestSyncResult.NotModified
                HttpURLConnection.HTTP_NOT_FOUND -> DigestSyncResult.NoDigestYet
                // 401s deliberately leak no detail; the status alone means the session is dead.
                HttpURLConnection.HTTP_UNAUTHORIZED -> DigestSyncResult.SignedOut
                HttpURLConnection.HTTP_CONFLICT ->
                    when (json.apiErrorCode(response.errorBody())) {
                        ApiErrorCode.GMAIL_RECONNECT_REQUIRED -> DigestSyncResult.GmailReconnectRequired
                        ApiErrorCode.GMAIL_NOT_CONNECTED -> DigestSyncResult.GmailNotConnected
                        else -> DigestSyncResult.Failed
                    }
                else -> DigestSyncResult.Failed
            }
        }

        private suspend fun persist(
            digest: Digest,
            etag: String?,
        ) {
            val items =
                digest.sections.flatMapIndexed { sectionOrder, section ->
                    section.items.mapIndexed { itemOrder, item ->
                        DigestItemEntity(
                            messageId = item.messageId,
                            category = section.category.wireId,
                            sectionOrder = sectionOrder,
                            itemOrder = itemOrder,
                            sender = item.sender,
                            subject = item.subject,
                            summary = item.summary,
                            urgent = item.urgent,
                            receivedAt = item.receivedAt,
                        )
                    }
                }
            dao.replace(
                DigestEntity(
                    date = digest.date,
                    generatedAt = digest.generatedAt,
                    emailCount = digest.emailCount,
                    etag = etag,
                ),
                items,
            )
        }

        private fun DigestItemEntity.toDomain(): DigestItem =
            DigestItem(
                messageId = messageId,
                sender = sender,
                subject = subject,
                summary = summary,
                urgent = urgent,
                receivedAt = receivedAt,
                category = EmailCategory.fromWireId(category),
            )
    }
