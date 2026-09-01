package com.enat.app.ui.setup

import com.enat.app.data.auth.ConsentPrompt

/** Which retryable failure the setup flow hit; each maps to a plain-Amharic message. */
enum class SetupErrorKind {
    SIGN_IN_FAILED,
    AUTHORIZATION_FAILED,
    SCOPES_MISSING,
    NO_REFRESH_TOKEN,
    CONNECTION_FAILED,
}

/**
 * The setup flow's single source of truth: sealed state emitted by [SetupViewModel],
 * rendered by a stateless composable — the same shape as the home screen.
 */
sealed interface SetupUiState {
    /** BuildConfig still carries the placeholder client id — a build problem, not a user one. */
    data object ConfigMissing : SetupUiState

    data object SignInStep : SetupUiState

    data object SigningIn : SetupUiState

    data object Authorizing : SetupUiState

    /** Google's consent screen must be shown; the route fires [prompt] exactly once. */
    data class AwaitingConsent(
        val prompt: ConsentPrompt,
    ) : SetupUiState

    data object Connecting : SetupUiState

    /**
     * The final installer step (TICKET-205): ask for POST_NOTIFICATIONS so the
     * daily verse reminder may fire. Only reached on Android 13+ while the
     * permission is still undecided; a denial moves on to [Success] — the app
     * works fully without notifications and never asks again.
     */
    data object NotificationPermissionStep : SetupUiState

    data object Success : SetupUiState

    data class Error(
        val kind: SetupErrorKind,
    ) : SetupUiState
}
