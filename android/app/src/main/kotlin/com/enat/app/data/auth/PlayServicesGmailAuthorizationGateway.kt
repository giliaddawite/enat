package com.enat.app.data.auth

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.activity.result.IntentSenderRequest
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.ApiException
import com.google.android.gms.common.api.Scope
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

class PlayServicesGmailAuthorizationGateway
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val config: GoogleAuthConfig,
    ) : GmailAuthorizationGateway {
        override suspend fun requestAuthorization(): AuthorizationOutcome =
            try {
                toOutcome(
                    Identity.getAuthorizationClient(context)
                        .authorize(buildAuthorizationRequest())
                        .await(),
                )
            } catch (failure: ApiException) {
                AuthorizationOutcome.Failed(failure)
            }

        internal fun buildAuthorizationRequest(): AuthorizationRequest =
            AuthorizationRequest.builder()
                // openid plus least privilege: exactly the two Gmail scopes the backend
                // needs, never full mail. openid makes Google include an id_token in the
                // server-side code exchange so the backend can verify the grant belongs
                // to the signed-in account (it rejects with account_mismatch otherwise).
                .setRequestedScopes(REQUESTED_SCOPES.map(::Scope))
                // forceCodeForRefreshToken guarantees every auth code exchanges for a
                // refresh token server-side, at the cost of always showing the consent
                // screen — the right trade for a one-time setup flow, and what makes
                // re-running this step the fix for the backend's no_refresh_token error.
                .requestOfflineAccess(config.webClientId, true)
                .build()

        override fun resolveConsent(
            resultCode: Int,
            data: Intent?,
        ): AuthorizationOutcome {
            if (resultCode != Activity.RESULT_OK || data == null) {
                return AuthorizationOutcome.Cancelled
            }
            return try {
                toOutcome(Identity.getAuthorizationClient(context).getAuthorizationResultFromIntent(data))
            } catch (failure: ApiException) {
                AuthorizationOutcome.Failed(failure)
            }
        }

        private fun toOutcome(result: AuthorizationResult): AuthorizationOutcome {
            val pendingIntent = result.pendingIntent
            if (result.hasResolution() && pendingIntent != null) {
                return AuthorizationOutcome.ConsentRequired(
                    ConsentPrompt { launcher ->
                        launcher.launch(IntentSenderRequest.Builder(pendingIntent).build())
                    },
                )
            }
            if (!result.grantedScopes.containsAll(GMAIL_SCOPES)) {
                return AuthorizationOutcome.ScopesMissing
            }
            val serverAuthCode =
                result.serverAuthCode
                    ?: return AuthorizationOutcome.Failed(
                        IllegalStateException("Authorization granted without a server auth code"),
                    )
            return AuthorizationOutcome.AuthCodeGranted(serverAuthCode)
        }

        companion object {
            /** The granted-scopes gate: only the Gmail scopes are checked client-side. */
            val GMAIL_SCOPES =
                listOf(
                    "https://www.googleapis.com/auth/gmail.readonly",
                    "https://www.googleapis.com/auth/gmail.modify",
                )

            /** What is requested: openid on top, purely so the exchange returns an id_token. */
            val REQUESTED_SCOPES = listOf("openid") + GMAIL_SCOPES
        }
    }
