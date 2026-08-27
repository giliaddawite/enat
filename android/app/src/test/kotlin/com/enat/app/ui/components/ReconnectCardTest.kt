package com.enat.app.ui.components

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
import com.enat.app.ui.theme.EnatTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ReconnectCardTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun showsTitleAndPlainLanguageExplanation() {
        composeTestRule.setContent {
            EnatTheme {
                ReconnectCard(onReconnect = {})
            }
        }

        composeTestRule
            .onNodeWithText(context.getString(R.string.reconnect_title))
            .assertIsDisplayed()
        composeTestRule
            .onNodeWithText(context.getString(R.string.reconnect_body))
            .assertIsDisplayed()
    }

    @Test
    fun reconnectButtonMeetsTouchTargetAndEmitsEvent() {
        var reconnected = false
        composeTestRule.setContent {
            EnatTheme {
                ReconnectCard(onReconnect = { reconnected = true })
            }
        }

        val button = composeTestRule.onNodeWithText(context.getString(R.string.reconnect_button))
        button.assertHeightIsAtLeast(64.dp)
        button.performClick()

        assertTrue(reconnected)
    }
}
