package com.enat.app.ui.digest

import androidx.lifecycle.SavedStateHandle
import app.cash.turbine.test
import com.enat.app.MainDispatcherRule
import com.enat.app.data.digest.Digest
import com.enat.app.data.digest.DigestItem
import com.enat.app.data.digest.DigestRepository
import com.enat.app.data.digest.DigestSyncResult
import com.enat.app.data.digest.EmailCategory
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class DigestDetailViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val item =
        DigestItem(
            messageId = "m1",
            sender = "Bank",
            subject = "Statement",
            summary = "የባንክ መግለጫ ደርሷል።",
            urgent = false,
            receivedAt = "2026-08-25T09:00:00Z",
            category = EmailCategory.IMPORTANT,
        )

    private fun viewModel(cachedItem: DigestItem?): DigestDetailViewModel =
        DigestDetailViewModel(
            savedStateHandle = SavedStateHandle(mapOf(DigestDetailViewModel.MESSAGE_ID_ARG to "m1")),
            repository = FakeDigestRepository(cachedItem),
        )

    @Test
    fun `loads the cached item for its message id`() =
        runTest {
            viewModel(item).uiState.test {
                assertEquals(DigestDetailUiState.Loading, awaitItem())
                assertEquals(DigestDetailUiState.Detail(item), awaitItem())
            }
        }

    @Test
    fun `a message missing from the cache becomes the missing state`() =
        runTest {
            viewModel(null).uiState.test {
                assertEquals(DigestDetailUiState.Loading, awaitItem())
                assertEquals(DigestDetailUiState.Missing, awaitItem())
            }
        }

    private class FakeDigestRepository(
        private val item: DigestItem?,
    ) : DigestRepository {
        override suspend fun cachedDigest(): Digest? = error("not used")

        override suspend fun cachedItem(messageId: String): DigestItem? = if (messageId == "m1") item else null

        override suspend fun fetchLatest(): DigestSyncResult = error("not used")

        override suspend fun regenerate(): DigestSyncResult = error("not used")
    }
}
