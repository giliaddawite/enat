package com.enat.app.ui.setup

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
import com.enat.app.data.auth.ConsentPrompt
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
class SetupScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun setScreen(
        uiState: SetupUiState,
        onSignIn: () -> Unit = {},
        onRetry: () -> Unit = {},
        onDone: () -> Unit = {},
    ) {
        composeTestRule.setContent {
            EnatTheme {
                SetupScreen(
                    uiState = uiState,
                    onSignIn = onSignIn,
                    onRetry = onRetry,
                    onDone = onDone,
                )
            }
        }
    }

    @Test
    fun signInStep_showsIntroStepsAndSignInButton() {
        setScreen(SetupUiState.SignInStep)

        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_intro))
            .assertIsDisplayed()
        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_step_sign_in))
            .assertIsDisplayed()
        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_sign_in_button))
            .assertIsDisplayed()
    }

    @Test
    fun signInStep_signInButtonEmitsEventAndMeetsMinimumTouchTarget() {
        var signedIn = false
        setScreen(SetupUiState.SignInStep, onSignIn = { signedIn = true })

        val button =
            composeTestRule.onNodeWithText(context.getString(R.string.setup_sign_in_button))
        button.assertHeightIsAtLeast(64.dp)
        button.performClick()

        assertTrue(signedIn)
    }

    @Test
    fun signingIn_showsStatusText() {
        setScreen(SetupUiState.SigningIn)

        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_status_signing_in))
            .assertIsDisplayed()
    }

    @Test
    fun authorizing_showsStatusText() {
        setScreen(SetupUiState.Authorizing)

        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_status_authorizing))
            .assertIsDisplayed()
    }

    @Test
    fun awaitingConsent_showsAuthorizingStatusText() {
        setScreen(SetupUiState.AwaitingConsent(ConsentPrompt { }))

        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_status_authorizing))
            .assertIsDisplayed()
    }

    @Test
    fun connecting_showsStatusText() {
        setScreen(SetupUiState.Connecting)

        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_status_connecting))
            .assertIsDisplayed()
    }

    @Test
    fun success_showsSuccessTextAndDoneButtonEmitsEvent() {
        var done = false
        setScreen(SetupUiState.Success, onDone = { done = true })

        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_success_title))
            .assertIsDisplayed()
        val button = composeTestRule.onNodeWithText(context.getString(R.string.setup_done_button))
        button.assertHeightIsAtLeast(64.dp)
        button.performClick()

        assertTrue(done)
    }

    @Test
    fun connectionError_showsMessageAndRetryEmitsEvent() {
        var retried = false
        setScreen(SetupUiState.Error(SetupErrorKind.CONNECTION_FAILED), onRetry = { retried = true })

        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_error_connection))
            .assertIsDisplayed()
        val button = composeTestRule.onNodeWithText(context.getString(R.string.setup_retry_button))
        button.assertHeightIsAtLeast(64.dp)
        button.performClick()

        assertTrue(retried)
    }

    @Test
    fun scopesError_showsScopesExplanation() {
        setScreen(SetupUiState.Error(SetupErrorKind.SCOPES_MISSING))

        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_error_scopes))
            .assertIsDisplayed()
    }

    @Test
    fun noRefreshTokenError_showsReconnectCardAndReconnectEmitsRetry() {
        var retried = false
        setScreen(SetupUiState.Error(SetupErrorKind.NO_REFRESH_TOKEN), onRetry = { retried = true })

        composeTestRule
            .onNodeWithText(context.getString(R.string.reconnect_title))
            .assertIsDisplayed()
        composeTestRule
            .onNodeWithText(context.getString(R.string.reconnect_button))
            .performClick()

        assertTrue(retried)
    }

    @Test
    fun configMissing_showsSetupInstructionsError() {
        setScreen(SetupUiState.ConfigMissing)

        composeTestRule
            .onNodeWithText(context.getString(R.string.setup_error_config))
            .assertIsDisplayed()
    }
}
