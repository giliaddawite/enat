package com.enat.app.ui.home

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import com.enat.app.data.greeting.TimeOfDay
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
 * Hub goldens at both font-scale extremes (TICKET-301). Record with
 * `./gradlew recordRoborazziDebug`, verify with `verifyRoborazziDebug`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = SCREENSHOT_QUALIFIERS)
class HomeScreenScreenshotTest(
    private val fontScale: FontScaleExtreme,
) {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    // A fixed, locale-formatted date and time — the ViewModel formats these from
    // an injected clock; here they are plain inputs so the render is deterministic.
    private val hubState =
        HomeUiState.Hub(
            timeOfDay = TimeOfDay.MORNING,
            dateText = "ማክሰኞ፣ ኦገስት 25 2026",
            timeText = "10:15",
            showCallNotConfigured = false,
        )

    private fun setScreen(uiState: HomeUiState) {
        composeTestRule.setScreenAtFontScale(fontScale) {
            HomeScreen(
                uiState = uiState,
                onOpenDigest = {},
                onOpenVerse = {},
                onCallFamily = {},
                onOpenSettings = {},
            )
        }
    }

    @Test
    fun loading() {
        setScreen(HomeUiState.Loading)

        composeTestRule.assertNoClippedText()
        composeTestRule.captureScreenshot(SCREEN, "loading", fontScale)
    }

    @Test
    fun hub() {
        setScreen(hubState)

        composeTestRule.assertNoClippedText()
        composeTestRule.captureScreenshot(SCREEN, "hub", fontScale)
    }

    @Test
    fun hubWithCallNotConfiguredNotice() {
        setScreen(hubState.copy(showCallNotConfigured = true))

        composeTestRule.assertNoClippedText()
        composeTestRule.captureScreenshot(SCREEN, "hub_call_not_configured", fontScale)
    }

    companion object {
        private const val SCREEN = "home"

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}")
        fun fontScales(): List<FontScaleExtreme> = FontScaleExtreme.entries
    }
}
