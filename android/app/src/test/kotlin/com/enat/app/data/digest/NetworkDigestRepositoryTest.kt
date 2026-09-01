package com.enat.app.data.digest

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.enat.app.data.auth.SignedOutException
import com.enat.app.data.db.EnatDatabase
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/**
 * The repository against a real Retrofit stack (MockWebServer) and a real
 * in-memory Room cache — asserting the observable contract: what gets cached,
 * which headers travel, and how every response shape maps to a result value.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class NetworkDigestRepositoryTest {
    private val server = MockWebServer()
    private lateinit var database: EnatDatabase
    private lateinit var repository: NetworkDigestRepository

    private val digestJson =
        """
        {
          "date": "2026-08-25",
          "userId": "user-1",
          "sections": [
            {
              "category": "important",
              "items": [
                {
                  "messageId": "m1",
                  "from": "Bank",
                  "subject": "Statement",
                  "summary": "የባንክ መግለጫ ደርሷል።",
                  "urgent": true,
                  "receivedAt": "2026-08-25T09:00:00Z"
                }
              ]
            },
            {
              "category": "promotions_other",
              "items": [
                {
                  "messageId": "m2",
                  "from": "Shop",
                  "subject": "Sale",
                  "summary": null,
                  "urgent": false,
                  "receivedAt": "2026-08-25T08:00:00Z"
                }
              ]
            }
          ],
          "generatedAt": "2026-08-25T10:00:00Z",
          "emailCount": 2
        }
        """.trimIndent()

    @Before
    fun setUp() {
        server.start()
        val context: Context = ApplicationProvider.getApplicationContext()
        database =
            Room.inMemoryDatabaseBuilder(context, EnatDatabase::class.java)
                .allowMainThreadQueries()
                .build()
        val json = Json { ignoreUnknownKeys = true }
        val api =
            Retrofit.Builder()
                .baseUrl(server.url("/v1/"))
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                .build()
                .create(DigestApi::class.java)
        repository = NetworkDigestRepository(api, database.digestDao(), json)
    }

    @After
    fun tearDown() {
        server.shutdown()
        database.close()
    }

    @Test
    fun `a 200 is persisted and served from the cache`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v1\"").setBody(digestJson))

            val result = repository.fetchLatest()

            assertTrue(result is DigestSyncResult.Success)
            val cached = repository.cachedDigest()
            assertEquals("2026-08-25", cached?.date)
            assertEquals(2, cached?.emailCount)
            assertEquals(
                listOf(EmailCategory.IMPORTANT, EmailCategory.PROMOTIONS_OTHER),
                cached?.sections?.map { it.category },
            )
            val important = cached?.sections?.first()?.items?.single()
            assertEquals("Bank", important?.sender)
            assertEquals("የባንክ መግለጫ ደርሷል።", important?.summary)
            assertEquals(true, important?.urgent)
            // The heuristic-only item survives with its null summary.
            assertNull(cached?.sections?.last()?.items?.single()?.summary)
        }

    @Test
    fun `revalidation replays the stored ETag and maps 304 to NotModified`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v1\"").setBody(digestJson))
            repository.fetchLatest()
            server.takeRequest()

            server.enqueue(MockResponse().setResponseCode(304))
            val result = repository.fetchLatest()

            assertEquals(DigestSyncResult.NotModified, result)
            assertEquals("\"v1\"", server.takeRequest().getHeader("If-None-Match"))
            // The cache is untouched.
            assertEquals("2026-08-25", repository.cachedDigest()?.date)
        }

    @Test
    fun `the first fetch sends no If-None-Match header`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v1\"").setBody(digestJson))

            repository.fetchLatest()

            assertNull(server.takeRequest().getHeader("If-None-Match"))
        }

    @Test
    fun `a hostile ETag is dropped instead of poisoning revalidation`() =
        runTest {
            // Outside printable ASCII: replaying it as If-None-Match would make
            // OkHttp throw IllegalArgumentException on every later load — and a
            // persisted value makes that crash sticky. addHeaderLenient bypasses
            // MockWebServer's own validation, like a hostile server would.
            server.enqueue(
                MockResponse().setResponseCode(200).addHeaderLenient("ETag", "\"v1é\"").setBody(digestJson),
            )
            val first = repository.fetchLatest()
            assertTrue(first is DigestSyncResult.Success)
            server.takeRequest()

            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v2\"").setBody(digestJson))
            val second = repository.fetchLatest()

            // No crash, and the poisoned value was never persisted: the
            // revalidation simply went out unconditional.
            assertTrue(second is DigestSyncResult.Success)
            assertNull(server.takeRequest().getHeader("If-None-Match"))
        }

    @Test
    fun `a malformed body maps to Failed instead of crashing`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(200).setBody("not json at all"))

            assertEquals(DigestSyncResult.Failed, repository.fetchLatest())
        }

    @Test
    fun `404 maps to NoDigestYet`() =
        runTest {
            server.enqueue(errorResponse(404, "digest_not_found"))

            assertEquals(DigestSyncResult.NoDigestYet, repository.fetchLatest())
        }

    @Test
    fun `409 gmail_reconnect_required maps to GmailReconnectRequired`() =
        runTest {
            server.enqueue(errorResponse(409, "gmail_reconnect_required"))

            assertEquals(DigestSyncResult.GmailReconnectRequired, repository.regenerate())
        }

    @Test
    fun `409 gmail_not_connected maps to GmailNotConnected`() =
        runTest {
            server.enqueue(errorResponse(409, "gmail_not_connected"))

            assertEquals(DigestSyncResult.GmailNotConnected, repository.regenerate())
        }

    @Test
    fun `401 maps to SignedOut`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(401))

            assertEquals(DigestSyncResult.SignedOut, repository.fetchLatest())
        }

    @Test
    fun `500 maps to Failed`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(500))

            assertEquals(DigestSyncResult.Failed, repository.fetchLatest())
        }

    @Test
    fun `a connection failure maps to Offline and keeps the cache`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v1\"").setBody(digestJson))
            repository.fetchLatest()

            server.shutdown()
            val result = repository.fetchLatest()

            assertEquals(DigestSyncResult.Offline, result)
            // Airplane mode after one sync: the cached digest is still fully readable.
            assertEquals("2026-08-25", repository.cachedDigest()?.date)
            assertEquals("Bank", repository.cachedItem("m1")?.sender)
        }

    @Test
    fun `a mint failure surfaces as SignedOut`() =
        runTest {
            // A client whose interceptor throws exactly what AuthInterceptor throws
            // when no credential can be minted.
            val json = Json { ignoreUnknownKeys = true }
            val signedOutApi =
                Retrofit.Builder()
                    .baseUrl(server.url("/v1/"))
                    .client(
                        OkHttpClient.Builder()
                            .addInterceptor { throw SignedOutException() }
                            .build(),
                    )
                    .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                    .build()
                    .create(DigestApi::class.java)
            val signedOutRepository = NetworkDigestRepository(signedOutApi, database.digestDao(), json)

            assertEquals(DigestSyncResult.SignedOut, signedOutRepository.fetchLatest())
        }

    @Test
    fun `an unknown category lands in the catch-all bucket instead of dropping mail`() =
        runTest {
            val futureCategory = digestJson.replace("\"promotions_other\"", "\"brand_new_bucket\"")
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v1\"").setBody(futureCategory))

            repository.fetchLatest()

            assertEquals(
                EmailCategory.PROMOTIONS_OTHER,
                repository.cachedItem("m2")?.category,
            )
        }

    private fun errorResponse(
        code: Int,
        errorCode: String,
    ): MockResponse =
        MockResponse()
            .setResponseCode(code)
            .setBody("""{"error":{"code":"$errorCode","message":"","requestId":"r1"}}""")
}
