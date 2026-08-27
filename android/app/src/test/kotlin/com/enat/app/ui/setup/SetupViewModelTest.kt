package com.enat.app.ui.setup

import android.app.Activity
import android.content.Intent
import com.enat.app.MainDispatcherRule
import com.enat.app.data.auth.AuthorizationOutcome
import com.enat.app.data.auth.ConsentPrompt
import com.enat.app.data.auth.ConsentSubmissionResult
import com.enat.app.data.auth.GmailAuthorizationGateway
import com.enat.app.data.auth.GmailConsentRepository
import com.enat.app.data.auth.GoogleAuthConfig
import com.enat.app.data.auth.GoogleSignInGateway
import com.enat.app.data.auth.SignInOutcome
import com.enat.app.data.setup.SetupStateRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class SetupViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val activity = Activity()

    private val signInGateway = FakeSignInGateway(SignInOutcome.SignedIn(ID_TOKEN))
    private val authorizationGateway =
        FakeAuthorizationGateway(AuthorizationOutcome.AuthCodeGranted(AUTH_CODE))
    private val consentRepository = FakeConsentRepository(ConsentSubmissionResult.Accepted)
    private val setupStateRepository = FakeSetupStateRepository()

    private fun viewModel(configured: Boolean = true) =
        SetupViewModel(
            config =
                GoogleAuthConfig(
                    if (configured) "web-id.apps.googleusercontent.com" else "MISSING.apps.googleusercontent.com",
                ),
            signInGateway = signInGateway,
            authorizationGateway = authorizationGateway,
            consentRepository = consentRepository,
            setupStateRepository = setupStateRepository,
        )

    /** Collects every distinct state, including intermediates, for whole-machine assertions. */
    private fun TestScope.recordStates(viewModel: SetupViewModel): List<SetupUiState> {
        val states = mutableListOf<SetupUiState>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            viewModel.uiState.toList(states)
        }
        return states
    }

    @Test
    fun `starts at the sign-in step when the client id is configured`() =
        runTest {
            assertEquals(SetupUiState.SignInStep, viewModel().uiState.value)
        }

    @Test
    fun `starts at config-missing when the client id is the placeholder`() =
        runTest {
            val viewModel = viewModel(configured = false)

            assertEquals(SetupUiState.ConfigMissing, viewModel.uiState.value)

            // The flow must not start without a client id.
            viewModel.startSignIn(activity)
            advanceUntilIdle()
            assertEquals(SetupUiState.ConfigMissing, viewModel.uiState.value)
            assertEquals(0, signInGateway.invocations)
        }

    @Test
    fun `happy path walks sign-in, authorization, connection, success`() =
        runTest {
            val viewModel = viewModel()
            val states = recordStates(viewModel)

            viewModel.startSignIn(activity)
            advanceUntilIdle()

            assertEquals(
                listOf(
                    SetupUiState.SignInStep,
                    SetupUiState.SigningIn,
                    SetupUiState.Authorizing,
                    SetupUiState.Connecting,
                    SetupUiState.Success,
                ),
                states,
            )
            assertTrue(setupStateRepository.complete)
            assertEquals(listOf(ID_TOKEN to AUTH_CODE), consentRepository.submissions)
        }

    @Test
    fun `consent screen path resumes after the activity result`() =
        runTest {
            authorizationGateway.requestOutcome = AuthorizationOutcome.ConsentRequired(ConsentPrompt { })
            authorizationGateway.consentOutcome = AuthorizationOutcome.AuthCodeGranted(AUTH_CODE)
            val viewModel = viewModel()
            val states = recordStates(viewModel)

            viewModel.startSignIn(activity)
            advanceUntilIdle()
            assertTrue(states.last() is SetupUiState.AwaitingConsent)

            viewModel.onConsentResult(RESULT_OK, null)
            advanceUntilIdle()

            assertEquals(SetupUiState.Success, states.last())
            assertEquals(listOf(ID_TOKEN to AUTH_CODE), consentRepository.submissions)
        }

    @Test
    fun `cancelled sign-in returns to the sign-in step, not an error`() =
        runTest {
            signInGateway.outcome = SignInOutcome.Cancelled
            val viewModel = viewModel()

            viewModel.startSignIn(activity)
            advanceUntilIdle()

            assertEquals(SetupUiState.SignInStep, viewModel.uiState.value)
        }

    @Test
    fun `failed sign-in shows the sign-in error and retry signs in again`() =
        runTest {
            signInGateway.outcome = SignInOutcome.Failed(IOException("boom"))
            val viewModel = viewModel()

            viewModel.startSignIn(activity)
            advanceUntilIdle()
            assertEquals(SetupUiState.Error(SetupErrorKind.SIGN_IN_FAILED), viewModel.uiState.value)

            signInGateway.outcome = SignInOutcome.SignedIn(ID_TOKEN)
            viewModel.retry(activity)
            advanceUntilIdle()

            assertEquals(SetupUiState.Success, viewModel.uiState.value)
            assertEquals(2, signInGateway.invocations)
        }

    @Test
    fun `unchecked scopes at authorization show the scopes error`() =
        runTest {
            authorizationGateway.requestOutcome = AuthorizationOutcome.ScopesMissing
            val viewModel = viewModel()

            viewModel.startSignIn(activity)
            advanceUntilIdle()

            assertEquals(SetupUiState.Error(SetupErrorKind.SCOPES_MISSING), viewModel.uiState.value)
        }

    @Test
    fun `cancelled consent screen shows the authorization error`() =
        runTest {
            authorizationGateway.requestOutcome = AuthorizationOutcome.ConsentRequired(ConsentPrompt { })
            authorizationGateway.consentOutcome = AuthorizationOutcome.Cancelled
            val viewModel = viewModel()

            viewModel.startSignIn(activity)
            advanceUntilIdle()
            viewModel.onConsentResult(RESULT_CANCELED, null)
            advanceUntilIdle()

            assertEquals(SetupUiState.Error(SetupErrorKind.AUTHORIZATION_FAILED), viewModel.uiState.value)
        }

    @Test
    fun `no_refresh_token shows the reconnect state and retry re-runs authorization only`() =
        runTest {
            consentRepository.result = ConsentSubmissionResult.NoRefreshToken
            val viewModel = viewModel()

            viewModel.startSignIn(activity)
            advanceUntilIdle()
            assertEquals(SetupUiState.Error(SetupErrorKind.NO_REFRESH_TOKEN), viewModel.uiState.value)

            consentRepository.result = ConsentSubmissionResult.Accepted
            viewModel.retry(activity)
            advanceUntilIdle()

            assertEquals(SetupUiState.Success, viewModel.uiState.value)
            // The re-prompt goes back to the authorization step with the held ID token —
            // no second sign-in.
            assertEquals(1, signInGateway.invocations)
            assertEquals(2, authorizationGateway.requestInvocations)
        }

    @Test
    fun `insufficient_scope from the backend shows the scopes error`() =
        runTest {
            consentRepository.result = ConsentSubmissionResult.InsufficientScope
            val viewModel = viewModel()

            viewModel.startSignIn(activity)
            advanceUntilIdle()

            assertEquals(SetupUiState.Error(SetupErrorKind.SCOPES_MISSING), viewModel.uiState.value)
        }

    @Test
    fun `invalid_grant maps to the authorization error so retry mints a fresh code`() =
        runTest {
            consentRepository.result = ConsentSubmissionResult.InvalidGrant
            val viewModel = viewModel()

            viewModel.startSignIn(activity)
            advanceUntilIdle()

            assertEquals(SetupUiState.Error(SetupErrorKind.AUTHORIZATION_FAILED), viewModel.uiState.value)
        }

    @Test
    fun `backend failure shows the connection error and retry re-authorizes then succeeds`() =
        runTest {
            consentRepository.result = ConsentSubmissionResult.Failed
            val viewModel = viewModel()

            viewModel.startSignIn(activity)
            advanceUntilIdle()
            assertEquals(SetupUiState.Error(SetupErrorKind.CONNECTION_FAILED), viewModel.uiState.value)
            assertFalse(setupStateRepository.complete)

            consentRepository.result = ConsentSubmissionResult.Accepted
            viewModel.retry(activity)
            advanceUntilIdle()

            assertEquals(SetupUiState.Success, viewModel.uiState.value)
            assertEquals(2, authorizationGateway.requestInvocations)
            assertTrue(setupStateRepository.complete)
        }

    private class FakeSignInGateway(
        var outcome: SignInOutcome,
    ) : GoogleSignInGateway {
        var invocations = 0

        override suspend fun signIn(activity: Activity): SignInOutcome {
            invocations++
            return outcome
        }
    }

    private class FakeAuthorizationGateway(
        var requestOutcome: AuthorizationOutcome,
        var consentOutcome: AuthorizationOutcome = AuthorizationOutcome.Cancelled,
    ) : GmailAuthorizationGateway {
        var requestInvocations = 0

        override suspend fun requestAuthorization(): AuthorizationOutcome {
            requestInvocations++
            return requestOutcome
        }

        override fun resolveConsent(
            resultCode: Int,
            data: Intent?,
        ): AuthorizationOutcome = consentOutcome
    }

    private class FakeConsentRepository(
        var result: ConsentSubmissionResult,
    ) : GmailConsentRepository {
        val submissions = mutableListOf<Pair<String, String>>()

        override suspend fun submitAuthCode(
            idToken: String,
            authCode: String,
        ): ConsentSubmissionResult {
            submissions += idToken to authCode
            return result
        }
    }

    private class FakeSetupStateRepository : SetupStateRepository {
        var complete = false

        override fun isSetupComplete(): Boolean = complete

        override fun markSetupComplete() {
            complete = true
        }
    }

    private companion object {
        const val ID_TOKEN = "id-token"
        const val AUTH_CODE = "auth-code"
        const val RESULT_OK = Activity.RESULT_OK
        const val RESULT_CANCELED = Activity.RESULT_CANCELED
    }
}
