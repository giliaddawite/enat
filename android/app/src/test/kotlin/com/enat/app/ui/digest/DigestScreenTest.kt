package com.enat.app.ui.digest

import android.app.Application
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.enat.app.R
import com.enat.app.data.digest.Digest
import com.enat.app.data.digest.DigestItem
import com.enat.app.data.digest.DigestSection
import com.enat.app.data.digest.EmailCategory
import com.enat.app.ui.theme.EnatTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "w411dp-h2000dp")
class DigestScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private val urgentItem =
        DigestItem(
            messageId = "m1",
            sender = "Bank",
            subject = "Statement",
            summary = "የባንክ መግለጫ ደርሷል።",
            urgent = true,
            receivedAt = "2026-08-25T09:00:00Z",
            category = EmailCategory.IMPORTANT,
        )

    private val summarylessItem =
        DigestItem(
            messageId = "m2",
            sender = "Shop",
            subject = "Big Sale",
            summary = null,
            urgent = false,
            receivedAt = "2026-08-25T08:00:00Z",
            category = EmailCategory.PROMOTIONS_OTHER,
        )

    private val digest =
        Digest(
            date = "2026-08-25",
            generatedAt = "2026-08-25T10:00:00Z",
            emailCount = 2,
            sections =
                listOf(
                    DigestSection(EmailCategory.IMPORTANT, listOf(urgentItem)),
                    DigestSection(EmailCategory.PROMOTIONS_OTHER, listOf(summarylessItem)),
                ),
        )

    private fun setScreen(
        uiState: DigestUiState,
        onOpenDetail: (String) -> Unit = {},
        onRefresh: () -> Unit = {},
        onReconnect: () -> Unit = {},
        onBack: () -> Unit = {},
    ) {
        composeTestRule.setContent {
            EnatTheme {
                DigestScreen(
                    uiState = uiState,
                    onBack = onBack,
                    onOpenDetail = onOpenDetail,
                    onRefresh = onRefresh,
                    onReconnect = onReconnect,
                )
            }
        }
    }

    @Test
    fun loadingState_explainsItselfInWords() {
        setScreen(DigestUiState.Loading(DigestUiState.LoadingKind.LOADING))

        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_loading))
            .assertIsDisplayed()
    }

    @Test
    fun generatingState_explainsTheWait() {
        setScreen(DigestUiState.Loading(DigestUiState.LoadingKind.GENERATING))

        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_generating))
            .assertIsDisplayed()
    }

    @Test
    fun content_showsSenderSummaryAndCategoryHeaders() {
        setScreen(DigestUiState.Content(digest, refreshing = false))

        composeTestRule.onNodeWithText(context.getString(R.string.category_important)).assertIsDisplayed()
        composeTestRule.onNodeWithText("Bank").assertIsDisplayed()
        composeTestRule.onNodeWithText("የባንክ መግለጫ ደርሷል።").assertIsDisplayed()
        // A summary-less (heuristic) card falls back to the subject line.
        composeTestRule.onNodeWithText("Big Sale").assertIsDisplayed()
    }

    @Test
    fun content_urgentBadgeShowsTextNotJustColor() {
        setScreen(DigestUiState.Content(digest, refreshing = false))

        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_urgent_badge))
            .assertIsDisplayed()
    }

    @Test
    fun content_tappingACardOpensItsDetail() {
        var openedId: String? = null
        setScreen(DigestUiState.Content(digest, refreshing = false), onOpenDetail = { openedId = it })

        composeTestRule.onNodeWithTag("digest_card_m1").performClick()

        assertEquals("m1", openedId)
    }

    @Test
    fun content_refreshButtonMeetsTouchTargetAndEmitsRefresh() {
        var refreshed = false
        setScreen(DigestUiState.Content(digest, refreshing = false), onRefresh = { refreshed = true })

        val refreshButton =
            composeTestRule.onNodeWithText(context.getString(R.string.digest_refresh_button))
        refreshButton.assertHeightIsAtLeast(64.dp)
        refreshButton.performClick()

        assertTrue(refreshed)
    }

    @Test
    fun content_refreshingStateSaysSoInWords() {
        setScreen(DigestUiState.Content(digest, refreshing = true))

        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_refreshing))
            .assertIsDisplayed()
    }

    @Test
    fun content_offlineNoticeIsShownWithTheCache() {
        setScreen(DigestUiState.Content(digest, refreshing = false, notice = DigestNotice.OFFLINE))

        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_notice_offline))
            .assertIsDisplayed()
        composeTestRule.onNodeWithText("Bank").assertIsDisplayed()
    }

    @Test
    fun emptyState_saysNoNewMailToday() {
        setScreen(DigestUiState.Empty())

        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_empty))
            .assertIsDisplayed()
        // Refresh stays available so mom can ask for a fresh look.
        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_refresh_button))
            .assertIsDisplayed()
    }

    @Test
    fun offlineError_showsPlainAmharicTextAndRetries() {
        var retried = false
        setScreen(DigestUiState.Error(DigestErrorKind.OFFLINE), onRefresh = { retried = true })

        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_error_offline))
            .assertIsDisplayed()
        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_retry_button))
            .performClick()

        assertTrue(retried)
    }

    @Test
    fun genericError_showsPlainAmharicText() {
        setScreen(DigestUiState.Error(DigestErrorKind.GENERIC))

        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_error_generic))
            .assertIsDisplayed()
    }

    @Test
    fun reconnectState_showsTheReconnectCardWiredToConsent() {
        var reconnected = false
        setScreen(DigestUiState.ReconnectRequired, onReconnect = { reconnected = true })

        composeTestRule.onNodeWithTag("reconnect_card").assertIsDisplayed()
        composeTestRule
            .onNodeWithText(context.getString(R.string.reconnect_button))
            .performClick()

        assertTrue(reconnected)
    }

    @Test
    fun backButton_meetsTouchTargetAndEmitsEvent() {
        var wentBack = false
        setScreen(DigestUiState.Content(digest, refreshing = false), onBack = { wentBack = true })

        val backButton =
            composeTestRule.onNodeWithContentDescription(context.getString(R.string.back_button))
        backButton.assertHeightIsAtLeast(64.dp)
        backButton.performClick()

        assertTrue(wentBack)
    }
}
