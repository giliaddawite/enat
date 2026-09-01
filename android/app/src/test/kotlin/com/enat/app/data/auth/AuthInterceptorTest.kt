package com.enat.app.data.auth

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AuthInterceptorTest {
    private val server = MockWebServer()
    private val tokenProvider = FakeIdTokenProvider()
    private lateinit var client: OkHttpClient

    @Before
    fun startServer() {
        server.start()
        client = OkHttpClient.Builder().addInterceptor(AuthInterceptor(tokenProvider)).build()
    }

    @After
    fun stopServer() {
        server.shutdown()
    }

    private fun request(builder: Request.Builder.() -> Unit = {}): Request =
        Request.Builder().url(server.url("/v1/digest")).apply(builder).build()

    @Test
    fun `attaches the minted token as a Bearer header`() {
        tokenProvider.token = "token-123"
        server.enqueue(MockResponse().setResponseCode(200))

        client.newCall(request()).execute().use { response ->
            assertEquals(200, response.code)
        }

        assertEquals("Bearer token-123", server.takeRequest().getHeader("Authorization"))
    }

    @Test
    fun `leaves an explicit Authorization header untouched`() {
        tokenProvider.token = "token-123"
        server.enqueue(MockResponse().setResponseCode(200))

        client.newCall(request { header("Authorization", "Bearer setup-token") }).execute().close()

        assertEquals("Bearer setup-token", server.takeRequest().getHeader("Authorization"))
        assertEquals(0, tokenProvider.mintCalls)
    }

    @Test
    fun `mint failure surfaces as SignedOutException without any request being sent`() {
        tokenProvider.token = null

        assertThrows(SignedOutException::class.java) {
            client.newCall(request()).execute()
        }

        assertEquals(0, server.requestCount)
    }

    @Test
    fun `a 401 response invalidates the cached token`() {
        tokenProvider.token = "stale-token"
        server.enqueue(MockResponse().setResponseCode(401))

        client.newCall(request()).execute().use { response ->
            assertEquals(401, response.code)
        }

        assertTrue(tokenProvider.invalidated)
    }

    @Test
    fun `a success response does not invalidate the token`() {
        tokenProvider.token = "token-123"
        server.enqueue(MockResponse().setResponseCode(200))

        client.newCall(request()).execute().close()

        assertEquals(false, tokenProvider.invalidated)
    }

    private class FakeIdTokenProvider : IdTokenProvider {
        var token: String? = null
        var mintCalls = 0
        var invalidated = false

        override suspend fun idToken(): String? {
            mintCalls += 1
            return token
        }

        override fun invalidate() {
            invalidated = true
        }
    }
}
