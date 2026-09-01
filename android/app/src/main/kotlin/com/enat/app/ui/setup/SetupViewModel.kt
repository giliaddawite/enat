package com.enat.app.ui.setup

import android.app.Activity
import android.content.Intent
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.enat.app.data.auth.AuthorizationOutcome
import com.enat.app.data.auth.ConsentSubmissionResult
import com.enat.app.data.auth.GmailAuthorizationGateway
import com.enat.app.data.auth.GmailConsentRepository
import com.enat.app.data.auth.GoogleAuthConfig
import com.enat.app.data.auth.GoogleSignInGateway
import com.enat.app.data.auth.SignInOutcome
import com.enat.app.data.setup.SetupStateRepository
import com.enat.app.notifications.NotificationPermissionGateway
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SetupViewModel
    @Inject
    constructor(
        config: GoogleAuthConfig,
        private val signInGateway: GoogleSignInGateway,
        private val authorizationGateway: GmailAuthorizationGateway,
        private val consentRepository: GmailConsentRepository,
        private val setupStateRepository: SetupStateRepository,
        private val notificationPermissionGateway: NotificationPermissionGateway,
    ) : ViewModel() {
        private val _uiState =
            MutableStateFlow<SetupUiState>(
                if (config.isConfigured) SetupUiState.SignInStep else SetupUiState.ConfigMissing,
            )
        val uiState: StateFlow<SetupUiState> = _uiState.asStateFlow()

        /** Held in memory for the backend call only — never logged, never persisted. */
        private var idToken: String? = null

        fun startSignIn(activity: Activity) {
            if (_uiState.value == SetupUiState.ConfigMissing) return
            _uiState.value = SetupUiState.SigningIn
            viewModelScope.launch {
                when (val outcome = signInGateway.signIn(activity)) {
                    is SignInOutcome.SignedIn -> {
                        idToken = outcome.idToken
                        authorize()
                    }
                    SignInOutcome.Cancelled -> _uiState.value = SetupUiState.SignInStep
                    is SignInOutcome.Failed -> fail(SetupErrorKind.SIGN_IN_FAILED, outcome.cause)
                }
            }
        }

        /**
         * Every post-sign-in failure retries from the authorization step: consent is
         * always forced, so retrying mints a fresh single-use auth code — safe even
         * when the previous code may already have been consumed (invalid_grant, a
         * request lost mid-flight) and exactly what no_refresh_token asks for.
         */
        fun retry(activity: Activity) {
            val error = _uiState.value as? SetupUiState.Error ?: return
            if (error.kind == SetupErrorKind.SIGN_IN_FAILED || idToken == null) {
                startSignIn(activity)
            } else {
                viewModelScope.launch { authorize() }
            }
        }

        fun onConsentResult(
            resultCode: Int,
            data: Intent?,
        ) {
            if (_uiState.value !is SetupUiState.AwaitingConsent) return
            viewModelScope.launch {
                handleAuthorization(authorizationGateway.resolveConsent(resultCode, data))
            }
        }

        private suspend fun authorize() {
            _uiState.value = SetupUiState.Authorizing
            handleAuthorization(authorizationGateway.requestAuthorization())
        }

        private suspend fun handleAuthorization(outcome: AuthorizationOutcome) {
            when (outcome) {
                is AuthorizationOutcome.AuthCodeGranted -> submitAuthCode(outcome.serverAuthCode)
                is AuthorizationOutcome.ConsentRequired ->
                    _uiState.value = SetupUiState.AwaitingConsent(outcome.prompt)
                AuthorizationOutcome.ScopesMissing -> fail(SetupErrorKind.SCOPES_MISSING)
                AuthorizationOutcome.Cancelled -> fail(SetupErrorKind.AUTHORIZATION_FAILED)
                is AuthorizationOutcome.Failed -> fail(SetupErrorKind.AUTHORIZATION_FAILED, outcome.cause)
            }
        }

        private suspend fun submitAuthCode(authCode: String) {
            val token = idToken
            if (token == null) {
                // Unreachable in practice — authorization only ever follows sign-in.
                fail(SetupErrorKind.SIGN_IN_FAILED)
                return
            }
            _uiState.value = SetupUiState.Connecting
            _uiState.value =
                when (consentRepository.submitAuthCode(token, authCode)) {
                    ConsentSubmissionResult.Accepted -> {
                        setupStateRepository.markSetupComplete()
                        // The notification ask comes after setup is already marked
                        // complete: it is a bonus step, never a gate on the app.
                        if (notificationPermissionGateway.needsRequest()) {
                            SetupUiState.NotificationPermissionStep
                        } else {
                            SetupUiState.Success
                        }
                    }
                    ConsentSubmissionResult.InvalidGrant ->
                        SetupUiState.Error(SetupErrorKind.AUTHORIZATION_FAILED)
                    ConsentSubmissionResult.NoRefreshToken ->
                        SetupUiState.Error(SetupErrorKind.NO_REFRESH_TOKEN)
                    ConsentSubmissionResult.InsufficientScope ->
                        SetupUiState.Error(SetupErrorKind.SCOPES_MISSING)
                    ConsentSubmissionResult.SessionExpired -> {
                        // The ID token (~1h) died mid-setup. Clearing it makes retry()
                        // route back through startSignIn for a fresh token instead of
                        // re-running authorization with the dead one forever.
                        idToken = null
                        SetupUiState.Error(SetupErrorKind.SIGN_IN_FAILED)
                    }
                    ConsentSubmissionResult.Failed ->
                        SetupUiState.Error(SetupErrorKind.CONNECTION_FAILED)
                }
        }

        /**
         * The system permission dialog answered. Granted or denied, setup moves on
         * to Success: a denial only means no morning reminder, and respecting it
         * without protest is the graceful-degradation requirement (TICKET-205).
         */
        fun onNotificationPermissionResult() {
            if (_uiState.value != SetupUiState.NotificationPermissionStep) return
            _uiState.value = SetupUiState.Success
        }

        private fun fail(
            kind: SetupErrorKind,
            cause: Exception? = null,
        ) {
            if (cause != null) {
                // The kind only — never the token, the auth code, or account details.
                Log.e(TAG, "Setup step failed: $kind", cause)
            }
            _uiState.value = SetupUiState.Error(kind)
        }

        private companion object {
            const val TAG = "SetupViewModel"
        }
    }
