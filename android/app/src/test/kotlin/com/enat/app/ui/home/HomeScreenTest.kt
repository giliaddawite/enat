package com.enat.app.ui.home

import android.app.Application
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.enat.app.R
import com.enat.app.data.greeting.TimeOfDay
import com.enat.app.ui.theme.EnatTheme
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Compose UI tests run on the JVM via Robolectric — no device needed, so they run in CI. */
@RunWith(RobolectricTestRunner::class)
// A tall qualifier keeps the whole hub on-screen: the oversized buttons overflow
// Robolectric's small default display, and off-screen nodes fail interaction asserts.
@Config(sdk = [34], application = Application::class, qualifiers = "w411dp-h2000dp")
class HomeScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private val hubState =
        HomeUiState.Hub(
            timeOfDay = TimeOfDay.MORNING,
            dateText = "Tuesday, August 25, 2026",
            timeText = "10:15 AM",
            showCallNotConfigured = false,
        )

    private fun setScreen(
        uiState: HomeUiState,
        onOpenDigest: () -> Unit = {},
        onOpenVerse: () -> Unit = {},
        onCallFamily: () -> Unit = {},
        onOpenSettings: () -> Unit = {},
    ) {
        composeTestRule.setContent {
            EnatTheme {
                HomeScreen(
                    uiState = uiState,
                    onOpenDigest = onOpenDigest,
                    onOpenVerse = onOpenVerse,
                    onCallFamily = onCallFamily,
                    onOpenSettings = onOpenSettings,
                )
            }
        }
    }

    @Test
    fun loadingState_showsLoadingText() {
        setScreen(HomeUiState.Loading)

        composeTestRule
            .onNodeWithText(context.getString(R.string.home_loading))
            .assertIsDisplayed()
    }

    @Test
    fun hub_showsGreetingDateAndTime() {
        setScreen(hubState)

        composeTestRule
            .onNodeWithText(context.getString(R.string.home_greeting_morning))
            .assertIsDisplayed()
        composeTestRule.onNodeWithTag("hub_date").assertIsDisplayed()
        composeTestRule.onNodeWithTag("hub_time").assertIsDisplayed()
    }

    @Test
    fun hub_buttonsMeetOversizedTouchTargets() {
        setScreen(hubState)

        // 64dp is the CLAUDE.md floor; the hub buttons are deliberately larger (96dp).
        listOf(R.string.hub_button_digest, R.string.hub_button_verse, R.string.hub_button_call)
            .forEach { label ->
                composeTestRule
                    .onNodeWithText(context.getString(label))
                    .assertHeightIsAtLeast(96.dp)
            }
    }

    @Test
    fun hub_digestButtonEmitsOpenDigest() {
        var opened = false
        setScreen(hubState, onOpenDigest = { opened = true })

        composeTestRule
            .onNodeWithText(context.getString(R.string.hub_button_digest))
            .performClick()

        assertTrue(opened)
    }

    @Test
    fun hub_verseButtonEmitsOpenVerse() {
        var opened = false
        setScreen(hubState, onOpenVerse = { opened = true })

        composeTestRule
            .onNodeWithText(context.getString(R.string.hub_button_verse))
            .performClick()

        assertTrue(opened)
    }

    @Test
    fun hub_callButtonEmitsCallFamily() {
        var called = false
        setScreen(hubState, onCallFamily = { called = true })

        composeTestRule
            .onNodeWithText(context.getString(R.string.hub_button_call))
            .performClick()

        assertTrue(called)
    }

    @Test
    fun hub_showsNotConfiguredNoticeWhenSet() {
        setScreen(hubState.copy(showCallNotConfigured = true))

        composeTestRule
            .onNodeWithText(context.getString(R.string.hub_call_not_configured))
            .assertIsDisplayed()
    }

    @Test
    fun hub_longPressOnVersionOpensSettings_plainTapDoesNot() {
        var opened = false
        setScreen(hubState, onOpenSettings = { opened = true })

        composeTestRule.onNodeWithTag("hub_version").performClick()
        assertFalse(opened)

        composeTestRule.onNodeWithTag("hub_version").performTouchInput { longClick() }
        assertTrue(opened)
    }
}
