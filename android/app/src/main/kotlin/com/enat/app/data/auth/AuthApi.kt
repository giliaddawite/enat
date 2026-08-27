package com.enat.app.data.auth

import kotlinx.serialization.Serializable
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

@Serializable
data class GmailConsentRequest(
    val authCode: String,
)

/**
 * Setup-flow endpoints (relative to the /v1/ base URL). The ID token rides an
 * explicit header for now: an OkHttp interceptor that attaches it to every call
 * belongs to app-wide session management (follow-up ticket), not this one-time flow.
 */
interface AuthApi {
    @POST("auth/gmail-consent")
    suspend fun submitGmailConsent(
        @Header("Authorization") authorization: String,
        @Body request: GmailConsentRequest,
    ): Response<Unit>
}
