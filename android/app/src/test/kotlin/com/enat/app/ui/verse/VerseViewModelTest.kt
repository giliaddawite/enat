package com.enat.app.ui.verse

import app.cash.turbine.test
import com.enat.app.MainDispatcherRule
import com.enat.app.data.verse.Verse
import com.enat.app.data.verse.VerseRepository
import com.enat.app.data.verse.VerseSyncResult
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class VerseViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val repository = FakeVerseRepository()

    private val sampleVerse =
        Verse(
            date = "2026-09-01",
            reference = "Psalm 23:1",
            referenceAm = "መዝሙር 23፥1",
            textEn = "The LORD is my shepherd; I shall not want.",
            textAm = "እግዚአብሔር እረኛዬ ነው፤ የሚያሳጣኝም የለም።",
        )

    @Test
    fun `first open with no cache goes loading then content`() =
        runTest {
            repository.fetchResults += VerseSyncResult.Success(sampleVerse)
            val viewModel = VerseViewModel(repository)

            viewModel.uiState.test {
                assertEquals(VerseUiState.Loading, awaitItem())
                val content = awaitItem() as VerseUiState.Content
                assertEquals(sampleVerse, content.verse)
            }
        }

    @Test
    fun `the date key is formatted for display, not shown raw`() =
        runTest {
            repository.fetchResults += VerseSyncResult.Success(sampleVerse)
            val viewModel = VerseViewModel(repository)

            viewModel.uiState.test {
                awaitItem() // Loading
                val content = awaitItem() as VerseUiState.Content
                // Locale-formatted (FormatStyle.FULL always spells out more than
                // the 10-character ISO key), and never the raw wire value.
                assertTrue(content.dateText != sampleVerse.date)
                assertTrue(content.dateText.isNotBlank())
            }
        }

    @Test
    fun `a cached verse renders immediately and revalidation updates it`() =
        runTest {
            val updated = sampleVerse.copy(date = "2026-09-02", reference = "John 3:16")
            repository.cached = sampleVerse
            repository.fetchResults += VerseSyncResult.Success(updated)
            val viewModel = VerseViewModel(repository)

            viewModel.uiState.test {
                awaitItem() // initial Loading placeholder before the coroutine runs
                // Cache first — content is on screen before any network answer.
                assertEquals(sampleVerse, (awaitItem() as VerseUiState.Content).verse)
                assertEquals(updated, (awaitItem() as VerseUiState.Content).verse)
            }
        }

    @Test
    fun `offline with a cache shows the cached verse silently`() =
        runTest {
            repository.cached = sampleVerse
            repository.fetchResults += VerseSyncResult.Offline
            val viewModel = VerseViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                // Airplane mode is a normal day: the saved verse, no error, no notice.
                assertEquals(sampleVerse, (awaitItem() as VerseUiState.Content).verse)
                expectNoEvents()
            }
        }

    @Test
    fun `offline with no cache is a plain-language offline error`() =
        runTest {
            repository.fetchResults += VerseSyncResult.Offline
            val viewModel = VerseViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                assertEquals(VerseUiState.Error(VerseErrorKind.OFFLINE), awaitItem())
            }
        }

    @Test
    fun `a server failure with no cache is a generic error and retry recovers`() =
        runTest {
            repository.fetchResults += VerseSyncResult.Failed
            repository.fetchResults += VerseSyncResult.Success(sampleVerse)
            val viewModel = VerseViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                assertEquals(VerseUiState.Error(VerseErrorKind.GENERIC), awaitItem())

                viewModel.load()
                assertEquals(sampleVerse, (awaitItem() as VerseUiState.Content).verse)
            }
        }

    @Test
    fun `a server failure behind a cache keeps showing the cached verse`() =
        runTest {
            repository.cached = sampleVerse
            repository.fetchResults += VerseSyncResult.Failed
            val viewModel = VerseViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                assertEquals(sampleVerse, (awaitItem() as VerseUiState.Content).verse)
                expectNoEvents()
            }
        }

    @Test
    fun `a 304 keeps the cached verse on screen`() =
        runTest {
            repository.cached = sampleVerse
            repository.fetchResults += VerseSyncResult.NotModified
            val viewModel = VerseViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                assertEquals(sampleVerse, (awaitItem() as VerseUiState.Content).verse)
            }
        }

    @Test
    fun `signed out with no cache navigates to setup and leaves a retryable error`() =
        runTest {
            repository.fetchResults += VerseSyncResult.SignedOut
            val viewModel = VerseViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                assertEquals(VerseUiState.Error(VerseErrorKind.GENERIC), awaitItem())
            }
            viewModel.events.test {
                assertEquals(VerseEvent.NavigateToSetup, awaitItem())
            }
        }

    @Test
    fun `signed out behind a cache keeps showing the cached verse without navigating`() =
        runTest {
            repository.cached = sampleVerse
            repository.fetchResults += VerseSyncResult.SignedOut
            val viewModel = VerseViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                assertEquals(sampleVerse, (awaitItem() as VerseUiState.Content).verse)
            }
            viewModel.events.test {
                expectNoEvents()
            }
        }

    private class FakeVerseRepository : VerseRepository {
        var cached: Verse? = null
        val fetchResults = ArrayDeque<VerseSyncResult>()

        override suspend fun cachedVerse(): Verse? = cached

        override suspend fun fetchToday(): VerseSyncResult = fetchResults.removeFirst()
    }
}
