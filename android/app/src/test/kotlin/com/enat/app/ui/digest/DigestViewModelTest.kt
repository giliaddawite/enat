package com.enat.app.ui.digest

import app.cash.turbine.test
import com.enat.app.MainDispatcherRule
import com.enat.app.data.digest.Digest
import com.enat.app.data.digest.DigestItem
import com.enat.app.data.digest.DigestRepository
import com.enat.app.data.digest.DigestSection
import com.enat.app.data.digest.DigestSyncResult
import com.enat.app.data.digest.EmailCategory
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class DigestViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val repository = FakeDigestRepository()

    private val sampleDigest =
        Digest(
            date = "2026-08-25",
            generatedAt = "2026-08-25T10:00:00Z",
            emailCount = 1,
            sections =
                listOf(
                    DigestSection(
                        category = EmailCategory.IMPORTANT,
                        items =
                            listOf(
                                DigestItem(
                                    messageId = "m1",
                                    sender = "Bank",
                                    subject = "Statement",
                                    summary = "የባንክ መግለጫ ደርሷል።",
                                    urgent = true,
                                    receivedAt = "2026-08-25T09:00:00Z",
                                    category = EmailCategory.IMPORTANT,
                                ),
                            ),
                    ),
                ),
        )

    private val emptyDigest =
        Digest(date = "2026-08-25", generatedAt = "2026-08-25T10:00:00Z", emailCount = 0, sections = emptyList())

    @Test
    fun `first open with no cache goes loading then content`() =
        runTest {
            repository.fetchResults += DigestSyncResult.Success(sampleDigest)
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                assertEquals(DigestUiState.Loading(DigestUiState.LoadingKind.LOADING), awaitItem())
                assertEquals(DigestUiState.Content(sampleDigest, refreshing = false), awaitItem())
            }
        }

    @Test
    fun `a cached digest renders immediately and revalidates behind it`() =
        runTest {
            repository.cached = sampleDigest
            repository.fetchResults += DigestSyncResult.NotModified
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                awaitItem() // initial Loading placeholder before the coroutine runs
                // Cache first — content is on screen before any network answer.
                assertEquals(DigestUiState.Content(sampleDigest, refreshing = true), awaitItem())
                assertEquals(DigestUiState.Content(sampleDigest, refreshing = false), awaitItem())
            }
        }

    @Test
    fun `offline on first load with a cache shows the cache without an error`() =
        runTest {
            repository.cached = sampleDigest
            repository.fetchResults += DigestSyncResult.Offline
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                awaitItem() // Content(refreshing = true)
                // Airplane mode is a normal day: saved mail, no notice, no error.
                assertEquals(DigestUiState.Content(sampleDigest, refreshing = false, notice = null), awaitItem())
            }
        }

    @Test
    fun `offline with no cache is a plain-language offline error`() =
        runTest {
            repository.fetchResults += DigestSyncResult.Offline
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                assertEquals(DigestUiState.Error(DigestErrorKind.OFFLINE), awaitItem())
            }
        }

    @Test
    fun `a failed refresh keeps the cache and adds a notice`() =
        runTest {
            repository.cached = sampleDigest
            repository.fetchResults += DigestSyncResult.NotModified
            repository.regenerateResults += DigestSyncResult.Failed
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                awaitItem()
                awaitItem() // settled Content

                viewModel.refresh()
                assertEquals(DigestUiState.Content(sampleDigest, refreshing = true), awaitItem())
                assertEquals(
                    DigestUiState.Content(sampleDigest, refreshing = false, notice = DigestNotice.REFRESH_FAILED),
                    awaitItem(),
                )
            }
        }

    @Test
    fun `an offline refresh keeps the cache and says so`() =
        runTest {
            repository.cached = sampleDigest
            repository.fetchResults += DigestSyncResult.NotModified
            repository.regenerateResults += DigestSyncResult.Offline
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                awaitItem()
                awaitItem()

                viewModel.refresh()
                awaitItem() // refreshing = true
                assertEquals(
                    DigestUiState.Content(sampleDigest, refreshing = false, notice = DigestNotice.OFFLINE),
                    awaitItem(),
                )
            }
        }

    @Test
    fun `refresh regenerates and shows the fresh digest`() =
        runTest {
            repository.cached = sampleDigest
            repository.fetchResults += DigestSyncResult.NotModified
            val fresh = sampleDigest.copy(generatedAt = "2026-08-25T12:00:00Z")
            repository.regenerateResults += DigestSyncResult.Success(fresh)
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                awaitItem()
                awaitItem()

                viewModel.refresh()
                assertEquals(DigestUiState.Content(sampleDigest, refreshing = true), awaitItem())
                assertEquals(DigestUiState.Content(fresh, refreshing = false), awaitItem())
            }
            assertEquals(1, repository.regenerateCalls)
        }

    @Test
    fun `404 with no cache falls back to on-demand generation exactly once`() =
        runTest {
            repository.fetchResults += DigestSyncResult.NoDigestYet
            repository.regenerateResults += DigestSyncResult.Success(sampleDigest)
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                assertEquals(DigestUiState.Loading(DigestUiState.LoadingKind.LOADING), awaitItem())
                // The self-explaining generating message, never a bare spinner.
                assertEquals(DigestUiState.Loading(DigestUiState.LoadingKind.GENERATING), awaitItem())
                assertEquals(DigestUiState.Content(sampleDigest, refreshing = false), awaitItem())
            }
            assertEquals(1, repository.regenerateCalls)
        }

    @Test
    fun `404 after the one generation attempt settles on empty instead of looping`() =
        runTest {
            repository.fetchResults += DigestSyncResult.NoDigestYet
            repository.regenerateResults += DigestSyncResult.NoDigestYet
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                awaitItem() // GENERATING
                assertEquals(DigestUiState.Empty(), awaitItem())
            }
            assertEquals(1, repository.regenerateCalls)
        }

    @Test
    fun `an empty digest is the empty state`() =
        runTest {
            repository.fetchResults += DigestSyncResult.Success(emptyDigest)
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                assertEquals(DigestUiState.Empty(refreshing = false), awaitItem())
            }
        }

    @Test
    fun `gmail_reconnect_required shows the reconnect state`() =
        runTest {
            repository.fetchResults += DigestSyncResult.GmailReconnectRequired
            val viewModel = DigestViewModel(repository)

            viewModel.uiState.test {
                awaitItem()
                assertEquals(DigestUiState.ReconnectRequired, awaitItem())
            }
        }

    @Test
    fun `signed out navigates to setup`() =
        runTest {
            repository.fetchResults += DigestSyncResult.SignedOut
            val viewModel = DigestViewModel(repository)

            viewModel.events.test {
                assertEquals(DigestEvent.NavigateToSetup, awaitItem())
            }
        }

    @Test
    fun `gmail_not_connected navigates to setup`() =
        runTest {
            repository.fetchResults += DigestSyncResult.GmailNotConnected
            val viewModel = DigestViewModel(repository)

            viewModel.events.test {
                assertEquals(DigestEvent.NavigateToSetup, awaitItem())
            }
        }

    private class FakeDigestRepository : DigestRepository {
        var cached: Digest? = null
        val fetchResults = ArrayDeque<DigestSyncResult>()
        val regenerateResults = ArrayDeque<DigestSyncResult>()
        var regenerateCalls = 0

        override suspend fun cachedDigest(): Digest? = cached

        override suspend fun cachedItem(messageId: String): DigestItem? = error("not used")

        override suspend fun fetchLatest(): DigestSyncResult {
            // A real network call suspends; yielding here lets collectors observe
            // the in-between states (refreshing, generating) like they would live.
            yield()
            return fetchResults.removeFirst()
        }

        override suspend fun regenerate(): DigestSyncResult {
            regenerateCalls += 1
            yield()
            return regenerateResults.removeFirst()
        }
    }
}
