package com.enat.app.data.digest

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

/**
 * `/v1/digest` wire shapes (`backend/src/domain/digest.ts`). `userId` is present
 * in the response but deliberately unmapped — the app has exactly one user and
 * `ignoreUnknownKeys` skips it.
 */
@Serializable
data class DigestResponse(
    val date: String,
    val sections: List<DigestSectionDto>,
    val generatedAt: String,
    val emailCount: Int,
)

@Serializable
data class DigestSectionDto(
    val category: String,
    val items: List<DigestItemDto>,
)

@Serializable
data class DigestItemDto(
    val messageId: String,
    val from: String,
    val subject: String,
    val summary: String? = null,
    val urgent: Boolean,
    val receivedAt: String,
)

fun DigestResponse.toDomain(): Digest =
    Digest(
        date = date,
        generatedAt = generatedAt,
        emailCount = emailCount,
        sections =
            sections.map { section ->
                val category = EmailCategory.fromWireId(section.category)
                DigestSection(
                    category = category,
                    items =
                        section.items.map { item ->
                            DigestItem(
                                messageId = item.messageId,
                                sender = item.from,
                                subject = item.subject,
                                summary = item.summary,
                                urgent = item.urgent,
                                receivedAt = item.receivedAt,
                                category = category,
                            )
                        },
                )
            },
    )

/** Digest endpoints (relative to the /v1/ base URL). Auth rides the OkHttp interceptor. */
interface DigestApi {
    @GET("digest")
    suspend fun getDigest(
        @Header("If-None-Match") ifNoneMatch: String?,
    ): Response<DigestResponse>

    /** On-demand generation — the refresh button's path (and the 404 fallback). */
    @POST("digest/generate")
    suspend fun generateDigest(): Response<DigestResponse>
}
