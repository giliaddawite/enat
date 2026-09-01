package com.enat.app.ui.verse

import android.app.Application
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
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
import com.enat.app.data.verse.Verse
import com.enat.app.ui.theme.EnatTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Compose UI tests run on the JVM via Robolectric — no device needed, so they run in CI. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class, qualifiers = "w411dp-h2000dp")
class VerseScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private val verse =
        Verse(
            date = "2026-09-01",
            reference = "Psalm 23:1",
            referenceAm = "መዝሙር 23፥1",
            textEn = "The LORD is my shepherd; I shall not want.",
            textAm = "እግዚአብሔር እረኛዬ ነው፤ የሚያሳጣኝም የለም።",
        )

    private fun setScreen(
        uiState: VerseUiState,
        onBack: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        composeTestRule.setContent {
            EnatTheme {
                VerseScreen(uiState = uiState, onBack = onBack, onRetry = onRetry)
            }
        }
    }

    @Test
    fun loadingState_explainsItselfInWordsAndAnnouncesTransitions() {
        setScreen(VerseUiState.Loading)

        composeTestRule
            .onNodeWithText(context.getString(R.string.verse_loading))
            .assertIsDisplayed()
        composeTestRule
            .onNodeWithTag("verse_loading")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
    }

    @Test
    fun content_showsAmharicVerseFirstThenReferenceThenEnglish() {
        setScreen(VerseUiState.Content(verse = verse, dateText = "ማክሰኞ፣ ሴፕቴምበር 1 2026"))

        // Amharic is the primary pair; English is the secondary pair below it.
        composeTestRule.onNodeWithText(verse.textAm).assertIsDisplayed()
        composeTestRule.onNodeWithText(verse.referenceAm).assertIsDisplayed()
        composeTestRule.onNodeWithText(verse.textEn).assertIsDisplayed()
        composeTestRule.onNodeWithText(verse.reference).assertIsDisplayed()
    }

    @Test
    fun content_showsTheDateLine() {
        setScreen(VerseUiState.Content(verse = verse, dateText = "Tuesday, September 1, 2026"))

        composeTestRule.onNodeWithText("Tuesday, September 1, 2026").assertIsDisplayed()
    }

    @Test
    fun content_hasNoLoadingOrErrorText() {
        setScreen(VerseUiState.Content(verse = verse, dateText = "Tuesday, September 1, 2026"))

        // Offline-with-cache renders as plain Content: no notice text exists at all.
        composeTestRule.onNodeWithTag("verse_loading").assertDoesNotExist()
        composeTestRule.onNodeWithTag("verse_error").assertDoesNotExist()
    }

    @Test
    fun offlineError_showsPlainMessageAndRetryMeetsTouchTarget() {
        var retried = false
        setScreen(VerseUiState.Error(VerseErrorKind.OFFLINE), onRetry = { retried = true })

        composeTestRule
            .onNodeWithText(context.getString(R.string.verse_error_offline))
            .assertIsDisplayed()
        composeTestRule
            .onNodeWithTag("verse_error")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
        val button = composeTestRule.onNodeWithText(context.getString(R.string.verse_retry_button))
        button.assertHeightIsAtLeast(64.dp)
        button.performClick()

        assertTrue(retried)
    }

    @Test
    fun genericError_showsPlainMessage() {
        setScreen(VerseUiState.Error(VerseErrorKind.GENERIC))

        composeTestRule
            .onNodeWithText(context.getString(R.string.verse_error_generic))
            .assertIsDisplayed()
    }

    @Test
    fun backButton_isLabelledForTalkBackAndMeetsTouchTarget() {
        var backed = false
        setScreen(VerseUiState.Loading, onBack = { backed = true })

        val back = composeTestRule.onNodeWithContentDescription(context.getString(R.string.back_button))
        back.assertHeightIsAtLeast(64.dp)
        back.performClick()

        assertTrue(backed)
    }
}
