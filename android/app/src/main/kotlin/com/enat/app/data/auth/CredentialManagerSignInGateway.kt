package com.enat.app.data.auth

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import javax.inject.Inject

class CredentialManagerSignInGateway
    @Inject
    constructor(
        private val config: GoogleAuthConfig,
    ) : GoogleSignInGateway {
        override suspend fun signIn(activity: Activity): SignInOutcome {
            val googleIdOption =
                GetGoogleIdOption.Builder()
                    .setServerClientId(config.webClientId)
                    // The installer picks the account explicitly; on a clean install
                    // there are no previously authorized accounts to filter to.
                    .setFilterByAuthorizedAccounts(false)
                    .build()
            val request =
                GetCredentialRequest.Builder()
                    .addCredentialOption(googleIdOption)
                    .build()
            return try {
                val credential =
                    CredentialManager.create(activity)
                        .getCredential(activity, request)
                        .credential
                if (credential is CustomCredential &&
                    credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
                ) {
                    SignInOutcome.SignedIn(GoogleIdTokenCredential.createFrom(credential.data).idToken)
                } else {
                    SignInOutcome.Failed(IllegalStateException("Unexpected credential type: ${credential.type}"))
                }
            } catch (cancelled: GetCredentialCancellationException) {
                SignInOutcome.Cancelled
            } catch (failure: GetCredentialException) {
                SignInOutcome.Failed(failure)
            } catch (malformed: GoogleIdTokenParsingException) {
                SignInOutcome.Failed(malformed)
            }
        }
    }
