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
}
