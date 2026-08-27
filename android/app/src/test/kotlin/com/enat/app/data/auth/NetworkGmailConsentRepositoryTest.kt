package com.enat.app.data.auth

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.Response
import java.io.IOException

class NetworkGmailConsentRepositoryTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val authApi = FakeAuthApi(Response.success(204, Unit))
    private val repository = NetworkGmailConsentRepository(authApi, json)

    @Test
    fun `204 is accepted, with the bearer token and auth code the backend expects`() =
        runTest {
            val result = repository.submitAuthCode("id-token", "auth-code")

            assertEquals(ConsentSubmissionResult.Accepted, result)
            assertEquals("Bearer id-token", authApi.lastAuthorization)
            assertEquals(GmailConsentRequest("auth-code"), authApi.lastRequest)
        }

    @Test
    fun `invalid_grant maps to InvalidGrant`() =
        runTest {
            authApi.response = errorResponse(400, ApiErrorCode.INVALID_GRANT)

            assertEquals(ConsentSubmissionResult.InvalidGrant, repository.submitAuthCode("t", "c"))
        }

    @Test
    fun `no_refresh_token maps to NoRefreshToken`() =
        runTest {
            authApi.response = errorResponse(400, ApiErrorCode.NO_REFRESH_TOKEN)

            assertEquals(ConsentSubmissionResult.NoRefreshToken, repository.submitAuthCode("t", "c"))
        }

    @Test
    fun `insufficient_scope maps to InsufficientScope`() =
        runTest {
            authApi.response = errorResponse(400, ApiErrorCode.INSUFFICIENT_SCOPE)

            assertEquals(ConsentSubmissionResult.InsufficientScope, repository.submitAuthCode("t", "c"))
        }

    @Test
    fun `401 maps to SessionExpired even without an envelope body`() =
        runTest {
            // 401s deliberately leak no detail — the status alone must be enough.
            authApi.response = Response.error(401, "".toResponseBody("application/json".toMediaType()))

            assertEquals(ConsentSubmissionResult.SessionExpired, repository.submitAuthCode("t", "c"))
        }

    @Test
    fun `an oversized error body is read capped and treated as generic, not a crash`() =
        runTest {
            val oversized = "x".repeat(64 * 1024)
            authApi.response =
                Response.error(500, oversized.toResponseBody("application/json".toMediaType()))

            assertEquals(ConsentSubmissionResult.Failed, repository.submitAuthCode("t", "c"))
        }

    @Test
    fun `account_mismatch maps to the generic retry path`() =
        runTest {
            authApi.response = errorResponse(400, ApiErrorCode.ACCOUNT_MISMATCH)

            assertEquals(ConsentSubmissionResult.Failed, repository.submitAuthCode("t", "c"))
        }

    @Test
    fun `unrecognized codes map to the generic failure`() =
        runTest {
            authApi.response = errorResponse(502, "bad_gateway")

            assertEquals(ConsentSubmissionResult.Failed, repository.submitAuthCode("t", "c"))
        }

    @Test
    fun `a non-envelope error body maps to the generic failure, not a crash`() =
        runTest {
            authApi.response =
                Response.error(503, "<html>Service Unavailable</html>".toResponseBody("text/html".toMediaType()))

            assertEquals(ConsentSubmissionResult.Failed, repository.submitAuthCode("t", "c"))
        }

    @Test
    fun `a network failure maps to the generic failure, not a crash`() =
        runTest {
            authApi.failure = IOException("airplane mode")

            assertEquals(ConsentSubmissionResult.Failed, repository.submitAuthCode("t", "c"))
        }

    private fun errorResponse(
        status: Int,
        code: String,
    ): Response<Unit> {
        val envelope = """{"error":{"code":"$code","message":"m","requestId":"r"}}"""
        return Response.error(status, envelope.toResponseBody("application/json".toMediaType()))
    }

    private class FakeAuthApi(
        var response: Response<Unit>,
        var failure: IOException? = null,
    ) : AuthApi {
        var lastAuthorization: String? = null
        var lastRequest: GmailConsentRequest? = null

        override suspend fun submitGmailConsent(
            authorization: String,
            request: GmailConsentRequest,
        ): Response<Unit> {
            lastAuthorization = authorization
            lastRequest = request
            failure?.let { throw it }
            return response
        }
    }
}
