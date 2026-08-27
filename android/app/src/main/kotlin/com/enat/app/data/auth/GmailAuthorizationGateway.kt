package com.enat.app.data.auth

import android.content.Intent
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.IntentSenderRequest

/**
 * A deferred launch of Google's consent screen. Wrapping the PendingIntent behind a
 * function keeps the ViewModel — and its JVM tests — free of Android framework
 * instances that cannot exist off-device.
 */
fun interface ConsentPrompt {
    fun launch(launcher: ActivityResultLauncher<IntentSenderRequest>)
}

sealed interface AuthorizationOutcome {
    data class AuthCodeGranted(
        val serverAuthCode: String,
    ) : AuthorizationOutcome

    /** Google needs to show its consent screen; fire [prompt] and wait for the result. */
    data class ConsentRequired(
        val prompt: ConsentPrompt,
    ) : AuthorizationOutcome

    /** The user granted sign-in but unchecked one or both Gmail scopes. */
    data object ScopesMissing : AuthorizationOutcome

    data object Cancelled : AuthorizationOutcome

    data class Failed(
        val cause: Exception,
    ) : AuthorizationOutcome
}

/** Seam over Play Services' AuthorizationClient (server auth-code flow). */
interface GmailAuthorizationGateway {
    suspend fun requestAuthorization(): AuthorizationOutcome

    fun resolveConsent(
        resultCode: Int,
        data: Intent?,
    ): AuthorizationOutcome
}
