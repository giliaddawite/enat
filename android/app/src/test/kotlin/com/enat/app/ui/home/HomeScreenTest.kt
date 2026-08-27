package com.enat.app.ui.home

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
import com.enat.app.data.greeting.TimeOfDay
import com.enat.app.ui.theme.EnatTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Compose UI tests run on the JVM via Robolectric — no device needed, so they run in CI. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class HomeScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun setScreen(
        uiState: HomeUiState,
        onRefresh: () -> Unit = {},
    ) {
        composeTestRule.setContent {
            EnatTheme {
                HomeScreen(uiState = uiState, onRefresh = onRefresh)
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
    fun greetingState_showsTimeOfDayGreeting() {
        setScreen(HomeUiState.Greeting(TimeOfDay.MORNING))

        composeTestRule
            .onNodeWithText(context.getString(R.string.home_greeting_morning))
            .assertIsDisplayed()
    }

    @Test
    fun greetingState_refreshButtonEmitsRefreshEvent() {
        var refreshed = false
        setScreen(HomeUiState.Greeting(TimeOfDay.AFTERNOON), onRefresh = { refreshed = true })

        composeTestRule
            .onNodeWithText(context.getString(R.string.home_refresh_button))
            .performClick()

        assertTrue(refreshed)
    }

    @Test
    fun greetingState_refreshButtonMeetsMinimumTouchTarget() {
        setScreen(HomeUiState.Greeting(TimeOfDay.AFTERNOON))

        composeTestRule
            .onNodeWithText(context.getString(R.string.home_refresh_button))
            .assertHeightIsAtLeast(64.dp)
    }

    @Test
    fun errorState_showsErrorTextAndRetryEmitsRefreshEvent() {
        var refreshed = false
        setScreen(HomeUiState.Error, onRefresh = { refreshed = true })

        composeTestRule
            .onNodeWithText(context.getString(R.string.home_error))
            .assertIsDisplayed()
        composeTestRule
            .onNodeWithText(context.getString(R.string.home_retry_button))
            .performClick()

        assertTrue(refreshed)
    }
}
