package com.enat.app.data.verse

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.GET
import retrofit2.http.Header

/**
 * `/v1/verse/today` wire shape (`backend/src/domain/verse.ts`). The endpoint never
 * 404s for a signed-in user — selection failures degrade to a fallback verse served
 * as a 200, so the app has no "no verse today" case to handle.
 */
@Serializable
data class VerseResponse(
    val date: String,
    val reference: String,
    val referenceAm: String,
    val textEn: String,
    val textAm: String,
)

fun VerseResponse.toDomain(): Verse =
    Verse(
        date = date,
        reference = reference,
        referenceAm = referenceAm,
        textEn = textEn,
        textAm = textAm,
    )

/** Verse endpoint (relative to the /v1/ base URL). Auth rides the OkHttp interceptor. */
interface VerseApi {
    @GET("verse/today")
    suspend fun getVerseToday(
        @Header("If-None-Match") ifNoneMatch: String?,
    ): Response<VerseResponse>
}
