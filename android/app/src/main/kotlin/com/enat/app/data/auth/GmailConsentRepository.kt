package com.enat.app.data.auth

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import retrofit2.Response
import java.io.IOException
import java.net.HttpURLConnection
import javax.inject.Inject

sealed interface ConsentSubmissionResult {
    data object Accepted : ConsentSubmissionResult

    /** invalid_grant: the code was expired or already used — a fresh authorization fixes it. */
    data object InvalidGrant : ConsentSubmissionResult

    data object NoRefreshToken : ConsentSubmissionResult

    data object InsufficientScope : ConsentSubmissionResult

    /** 401: the Google ID token expired mid-setup — sign in again for a fresh one. */
    data object SessionExpired : ConsentSubmissionResult

    /** Network failures, 5xx, and unrecognized codes — generic retry. */
    data object Failed : ConsentSubmissionResult
}

interface GmailConsentRepository {
    suspend fun submitAuthCode(
        idToken: String,
        authCode: String,
    ): ConsentSubmissionResult
}

class NetworkGmailConsentRepository
    @Inject
    constructor(
        private val authApi: AuthApi,
        private val json: Json,
    ) : GmailConsentRepository {
        override suspend fun submitAuthCode(
            idToken: String,
            authCode: String,
        ): ConsentSubmissionResult {
            val response =
                try {
                    authApi.submitGmailConsent("Bearer $idToken", GmailConsentRequest(authCode))
                } catch (unreachable: IOException) {
                    // Offline or the server is down — a retryable state, never a crash.
                    return ConsentSubmissionResult.Failed
                }
            if (response.isSuccessful) {
                return ConsentSubmissionResult.Accepted
            }
            if (response.code() == HttpURLConnection.HTTP_UNAUTHORIZED) {
                // 401s deliberately leak no detail (no envelope code), so branch on the
                // status: the ID token is dead and only a fresh sign-in can replace it.
                return ConsentSubmissionResult.SessionExpired
            }
            return when (errorCode(response)) {
                ApiErrorCode.INVALID_GRANT -> ConsentSubmissionResult.InvalidGrant
                ApiErrorCode.NO_REFRESH_TOKEN -> ConsentSubmissionResult.NoRefreshToken
                ApiErrorCode.INSUFFICIENT_SCOPE -> ConsentSubmissionResult.InsufficientScope
                // Deliberately generic: retrying the flow lets the right account be picked.
                ApiErrorCode.ACCOUNT_MISMATCH -> ConsentSubmissionResult.Failed
                else -> ConsentSubmissionResult.Failed
            }
        }

        private fun errorCode(response: Response<Unit>): String? {
            val errorBody = response.errorBody() ?: return null
            val body =
                try {
                    errorBody.source().use { source ->
                        // The envelope is tiny; cap the read so a hostile intermediary
                        // cannot balloon memory with an arbitrarily large error body. A
                        // truncated body simply fails to parse and lands on the generic path.
                        source.request(MAX_ERROR_BODY_BYTES)
                        source.buffer.readUtf8(minOf(source.buffer.size, MAX_ERROR_BODY_BYTES))
                    }
                } catch (unreadable: IOException) {
                    return null
                }
            return try {
                json.decodeFromString<ApiErrorEnvelope>(body).error.code
            } catch (malformed: SerializationException) {
                // Proxies and crash pages answer with non-envelope bodies; treat as generic.
                null
            }
        }

        private companion object {
            const val MAX_ERROR_BODY_BYTES = 8L * 1024
        }
    }
