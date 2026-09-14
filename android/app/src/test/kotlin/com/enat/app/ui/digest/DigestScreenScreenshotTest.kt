package com.enat.app.ui.digest

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.enat.app.data.digest.Digest
import com.enat.app.data.digest.DigestItem
import com.enat.app.data.digest.DigestSection
import com.enat.app.data.digest.EmailCategory
import com.enat.app.screenshot.FontScaleExtreme
import com.enat.app.screenshot.SCREENSHOT_QUALIFIERS
import com.enat.app.screenshot.assertNoClippedText
import com.enat.app.screenshot.captureScreenshot
import com.enat.app.screenshot.setScreenAtFontScale
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Digest goldens at both font-scale extremes (TICKET-301). Record with
 * `./gradlew recordRoborazziDebug`, verify with `verifyRoborazziDebug`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = SCREENSHOT_QUALIFIERS)
class DigestScreenScreenshotTest(
    private val fontScale: FontScaleExtreme,
) {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    private val digest =
        Digest(
            date = "2026-08-25",
            generatedAt = "2026-08-25T10:00:00Z",
            emailCount = 2,
            sections =
                listOf(
                    DigestSection(
                        category = EmailCategory.IMPORTANT,
                        items =
                            listOf(
                                DigestItem(
                                    messageId = "m1",
                                    sender = "የኢትዮጵያ ንግድ ባንክ",
                                    subject = "Statement",
                                    summary = "የነሐሴ ወር የባንክ መግለጫዎ ደርሷል። እባክዎ ይመልከቱት።",
                                    urgent = true,
                                    receivedAt = "2026-08-25T09:00:00Z",
                                    category = EmailCategory.IMPORTANT,
                                ),
                            ),
                    ),
                    DigestSection(
                        category = EmailCategory.PROMOTIONS_OTHER,
                        items =
                            listOf(
                                DigestItem(
                                    messageId = "m2",
                                    sender = "Shop",
                                    subject = "Big Sale",
                                    // Category-only (heuristic) card: falls back to the subject.
                                    summary = null,
                                    urgent = false,
                                    receivedAt = "2026-08-25T08:00:00Z",
                                    category = EmailCategory.PROMOTIONS_OTHER,
                                ),
                            ),
                    ),
                ),
        )

    private fun setScreen(uiState: DigestUiState) {
        composeTestRule.setScreenAtFontScale(fontScale) {
            DigestScreen(
                uiState = uiState,
                onBack = {},
                onOpenDetail = {},
                onRefresh = {},
                onReconnect = {},
            )
        }
    }

    @Test
    fun loadingFirstOpen() {
        setScreen(DigestUiState.Loading(DigestUiState.LoadingKind.LOADING))

        composeTestRule.assertNoClippedText()
        composeTestRule.captureScreenshot(SCREEN, "loading_first_open", fontScale)
    }

    @Test
    fun loadingGenerating() {
        setScreen(DigestUiState.Loading(DigestUiState.LoadingKind.GENERATING))

        composeTestRule.assertNoClippedText()
        composeTestRule.captureScreenshot(SCREEN, "loading_generating", fontScale)
    }

    @Test
    fun content() {
        // Refreshing indicator and a notice together: the densest header the screen shows.
        setScreen(DigestUiState.Content(digest, refreshing = true, notice = DigestNotice.REFRESH_FAILED))

        composeTestRule.assertNoClippedText()
        composeTestRule.captureScreenshot(SCREEN, "content", fontScale)
    }

    @Test
    fun empty() {
        setScreen(DigestUiState.Empty())

        composeTestRule.assertNoClippedText()
        composeTestRule.captureScreenshot(SCREEN, "empty", fontScale)
    }

    @Test
    fun errorOffline() {
        setScreen(DigestUiState.Error(DigestErrorKind.OFFLINE))

        composeTestRule.assertNoClippedText()
        composeTestRule.captureScreenshot(SCREEN, "error_offline", fontScale)
    }

    @Test
    fun errorGeneric() {
        setScreen(DigestUiState.Error(DigestErrorKind.GENERIC))

        composeTestRule.assertNoClippedText()
        composeTestRule.captureScreenshot(SCREEN, "error_generic", fontScale)
    }

    @Test
    fun reconnectRequired() {
        setScreen(DigestUiState.ReconnectRequired)

        composeTestRule.assertNoClippedText()
        composeTestRule.captureScreenshot(SCREEN, "reconnect_required", fontScale)
    }

    companion object {
        private const val SCREEN = "digest"

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun fontScales(): List<FontScaleExtreme> = FontScaleExtreme.entries
    }
}
