package com.enat.app.data.auth

import android.app.Activity

/** Result of asking the user to pick a Google account and mint an ID token. */
sealed interface SignInOutcome {
    data class SignedIn(
        val idToken: String,
    ) : SignInOutcome

    data object Cancelled : SignInOutcome

    data class Failed(
        val cause: Exception,
    ) : SignInOutcome
}

/**
 * Thin seam over the Credential Manager API so the setup flow is unit-testable —
 * the real implementation talks to Google Play services, which only exists on a
 * device.
 */
interface GoogleSignInGateway {
    suspend fun signIn(activity: Activity): SignInOutcome

    /**
     * Mints a fresh ID token without showing UI (auto-select over the already
     * authorized account). Powers per-request auth on every /v1/ call after setup;
     * failure means "signed out" and routes back to the setup flow's sign-in.
     */
    suspend fun silentSignIn(): SignInOutcome
}
