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
        override suspend fun requestAuthorization(): AuthorizationOutcome {
            val request =
                AuthorizationRequest.builder()
                    // Least privilege: exactly the two scopes the backend needs, never full mail.
                    .setRequestedScopes(GMAIL_SCOPES.map(::Scope))
                    // forceCodeForRefreshToken guarantees every auth code exchanges for a
                    // refresh token server-side, at the cost of always showing the consent
                    // screen — the right trade for a one-time setup flow, and what makes
                    // re-running this step the fix for the backend's no_refresh_token error.
                    .requestOfflineAccess(config.webClientId, true)
                    .build()
            return try {
                toOutcome(Identity.getAuthorizationClient(context).authorize(request).await())
            } catch (failure: ApiException) {
                AuthorizationOutcome.Failed(failure)
            }
        }

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
            val GMAIL_SCOPES =
                listOf(
                    "https://www.googleapis.com/auth/gmail.readonly",
                    "https://www.googleapis.com/auth/gmail.modify",
                )
        }
    }
