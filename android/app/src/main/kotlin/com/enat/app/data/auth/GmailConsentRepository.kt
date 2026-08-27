package com.enat.app.data.auth

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import retrofit2.Response
import java.io.IOException
import javax.inject.Inject

sealed interface ConsentSubmissionResult {
    data object Accepted : ConsentSubmissionResult

    /** invalid_grant: the code was expired or already used — a fresh authorization fixes it. */
    data object InvalidGrant : ConsentSubmissionResult

    data object NoRefreshToken : ConsentSubmissionResult

    data object InsufficientScope : ConsentSubmissionResult

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
            return when (errorCode(response)) {
                ApiErrorCode.INVALID_GRANT -> ConsentSubmissionResult.InvalidGrant
                ApiErrorCode.NO_REFRESH_TOKEN -> ConsentSubmissionResult.NoRefreshToken
                ApiErrorCode.INSUFFICIENT_SCOPE -> ConsentSubmissionResult.InsufficientScope
                else -> ConsentSubmissionResult.Failed
            }
        }

        private fun errorCode(response: Response<Unit>): String? {
            val body = response.errorBody()?.string() ?: return null
            return try {
                json.decodeFromString<ApiErrorEnvelope>(body).error.code
            } catch (malformed: SerializationException) {
                // Proxies and crash pages answer with non-envelope bodies; treat as generic.
                null
            }
        }
    }
