package com.enat.app.data.verse

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
 * in-memory Room cache — the same observable-contract style as
 * NetworkDigestRepositoryTest: what gets cached, which headers travel, and how
 * every response shape maps to a result value.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class NetworkVerseRepositoryTest {
    private val server = MockWebServer()
    private val json = Json { ignoreUnknownKeys = true }
    private lateinit var database: EnatDatabase
    private lateinit var repository: NetworkVerseRepository

    private val verseJson =
        """
        {
          "date": "2026-09-01",
          "reference": "Psalm 23:1",
          "referenceAm": "መዝሙር 23፥1",
          "textEn": "The LORD is my shepherd; I shall not want.",
          "textAm": "እግዚአብሔር እረኛዬ ነው፤ የሚያሳጣኝም የለም።"
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
        repository = NetworkVerseRepository(api(), database.verseDao())
    }

    @After
    fun tearDown() {
        server.shutdown()
        database.close()
    }

    private fun api(client: OkHttpClient = OkHttpClient()): VerseApi =
        Retrofit.Builder()
            .baseUrl(server.url("/v1/"))
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(VerseApi::class.java)

    @Test
    fun `a 200 is persisted and served from the cache`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v1\"").setBody(verseJson))

            val result = repository.fetchToday()

            assertTrue(result is VerseSyncResult.Success)
            val cached = repository.cachedVerse()
            assertEquals("2026-09-01", cached?.date)
            assertEquals("መዝሙር 23፥1", cached?.referenceAm)
            assertEquals("እግዚአብሔር እረኛዬ ነው፤ የሚያሳጣኝም የለም።", cached?.textAm)
            assertEquals("Psalm 23:1", cached?.reference)
            assertEquals("The LORD is my shepherd; I shall not want.", cached?.textEn)
        }

    @Test
    fun `revalidation replays the stored ETag and maps 304 to NotModified`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v1\"").setBody(verseJson))
            repository.fetchToday()
            server.takeRequest()

            server.enqueue(MockResponse().setResponseCode(304))
            val result = repository.fetchToday()

            assertEquals(VerseSyncResult.NotModified, result)
            assertEquals("\"v1\"", server.takeRequest().getHeader("If-None-Match"))
            // The cache is untouched.
            assertEquals("2026-09-01", repository.cachedVerse()?.date)
        }

    @Test
    fun `the first fetch sends no If-None-Match header`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v1\"").setBody(verseJson))

            repository.fetchToday()

            assertNull(server.takeRequest().getHeader("If-None-Match"))
        }

    @Test
    fun `a new day's verse replaces the cached one whole`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v1\"").setBody(verseJson))
            repository.fetchToday()

            val tomorrow =
                verseJson
                    .replace("2026-09-01", "2026-09-02")
                    .replace("Psalm 23:1", "John 3:16")
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v2\"").setBody(tomorrow))
            repository.fetchToday()

            val cached = repository.cachedVerse()
            assertEquals("2026-09-02", cached?.date)
            assertEquals("John 3:16", cached?.reference)
        }

    @Test
    fun `401 maps to SignedOut`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(401))

            assertEquals(VerseSyncResult.SignedOut, repository.fetchToday())
        }

    @Test
    fun `500 maps to Failed`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(500))

            assertEquals(VerseSyncResult.Failed, repository.fetchToday())
        }

    @Test
    fun `a connection failure maps to Offline and keeps the cache`() =
        runTest {
            server.enqueue(MockResponse().setResponseCode(200).setHeader("ETag", "\"v1\"").setBody(verseJson))
            repository.fetchToday()

            server.shutdown()
            val result = repository.fetchToday()

            assertEquals(VerseSyncResult.Offline, result)
            // Airplane mode after one sync: the cached verse is still fully readable.
            assertEquals("እግዚአብሔር እረኛዬ ነው፤ የሚያሳጣኝም የለም።", repository.cachedVerse()?.textAm)
        }

    @Test
    fun `a mint failure surfaces as SignedOut`() =
        runTest {
            // A client whose interceptor throws exactly what AuthInterceptor throws
            // when no credential can be minted.
            val signedOutClient =
                OkHttpClient.Builder()
                    .addInterceptor { throw SignedOutException() }
                    .build()
            val signedOutRepository = NetworkVerseRepository(api(signedOutClient), database.verseDao())

            assertEquals(VerseSyncResult.SignedOut, signedOutRepository.fetchToday())
        }
}
