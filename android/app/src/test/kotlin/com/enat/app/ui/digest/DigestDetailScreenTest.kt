package com.enat.app.ui.digest

import android.app.Application
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.enat.app.R
import com.enat.app.data.digest.DigestItem
import com.enat.app.data.digest.EmailCategory
import com.enat.app.ui.theme.EnatTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "w411dp-h2000dp")
class DigestDetailScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private val item =
        DigestItem(
            messageId = "m1",
            sender = "Bank",
            subject = "Statement",
            summary = "የባንክ መግለጫ ደርሷል።",
            urgent = true,
            receivedAt = "2026-08-25T09:00:00Z",
            category = EmailCategory.BILLS_ACCOUNTS,
        )

    private fun setScreen(
        uiState: DigestDetailUiState,
        onOpenInGmail: (String) -> Unit = {},
        onBack: () -> Unit = {},
    ) {
        composeTestRule.setContent {
            EnatTheme {
                DigestDetailScreen(uiState = uiState, onOpenInGmail = onOpenInGmail, onBack = onBack)
            }
        }
    }

    @Test
    fun detail_showsSenderSubjectCategoryAndFullSummary() {
        setScreen(DigestDetailUiState.Detail(item))

        composeTestRule.onNodeWithText("Bank").assertIsDisplayed()
        composeTestRule.onNodeWithText("Statement").assertIsDisplayed()
        composeTestRule
            .onNodeWithText(context.getString(R.string.category_bills_accounts))
            .assertIsDisplayed()
        composeTestRule.onNodeWithText("የባንክ መግለጫ ደርሷል።").assertIsDisplayed()
        composeTestRule
            .onNodeWithText(context.getString(R.string.digest_urgent_badge))
            .assertIsDisplayed()
    }

    @Test
    fun detail_withoutSummarySaysSoInPlainLanguage() {
        setScreen(DigestDetailUiState.Detail(item.copy(summary = null, urgent = false)))

        composeTestRule
            .onNodeWithText(context.getString(R.string.detail_no_summary))
            .assertIsDisplayed()
    }

    @Test
    fun detail_openInGmailMeetsTouchTargetAndEmitsTheMessageId() {
        var openedId: String? = null
        setScreen(DigestDetailUiState.Detail(item), onOpenInGmail = { openedId = it })

        val gmailButton =
            composeTestRule.onNodeWithText(context.getString(R.string.detail_open_gmail_button))
        gmailButton.assertHeightIsAtLeast(64.dp)
        gmailButton.performClick()

        assertEquals("m1", openedId)
    }

    @Test
    fun missingState_showsPlainLanguageMessage() {
        setScreen(DigestDetailUiState.Missing)

        composeTestRule
            .onNodeWithText(context.getString(R.string.detail_not_found))
            .assertIsDisplayed()
    }
}
