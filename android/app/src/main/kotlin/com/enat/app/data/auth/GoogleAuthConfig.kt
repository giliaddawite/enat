package com.enat.app.data.auth

/**
 * The web OAuth client id used for sign-in and the server auth-code flow.
 * Configuration, not a secret — but it is injected from BuildConfig (Gradle property
 * `enatGoogleWebClientId`) so it never lives in a tracked file.
 */
data class GoogleAuthConfig(
    val webClientId: String,
) {
    /** The Gradle default is an obvious placeholder; treat it as "not set up yet". */
    val isConfigured: Boolean get() = !webClientId.startsWith(PLACEHOLDER_PREFIX)

    private companion object {
        const val PLACEHOLDER_PREFIX = "MISSING"
    }
}
