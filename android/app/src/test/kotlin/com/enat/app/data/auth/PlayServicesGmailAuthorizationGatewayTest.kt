package com.enat.app.data.auth

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The live authorize()/resolveConsent() calls need Play Services on a device and stay
 * out of test scope; the request the gateway builds is plain data and is the contract
 * the backend depends on, so it is asserted here.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class PlayServicesGmailAuthorizationGatewayTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val gateway =
        PlayServicesGmailAuthorizationGateway(
            context = context,
            config = GoogleAuthConfig("web-id.apps.googleusercontent.com"),
        )

    @Test
    fun `requests openid alongside exactly the two gmail scopes`() {
        val requested = gateway.buildAuthorizationRequest().requestedScopes.map { it.scopeUri }

        // openid makes the code exchange return an id_token, which the backend uses
        // to bind the grant to the signed-in account (account_mismatch otherwise).
        assertEquals(
            setOf(
                "openid",
                "https://www.googleapis.com/auth/gmail.readonly",
                "https://www.googleapis.com/auth/gmail.modify",
            ),
            requested.toSet(),
        )
        assertEquals(3, requested.size)
    }

    @Test
    fun `granted-scope gate checks only the gmail scopes, never openid`() {
        assertFalse(PlayServicesGmailAuthorizationGateway.GMAIL_SCOPES.contains("openid"))
        assertEquals(2, PlayServicesGmailAuthorizationGateway.GMAIL_SCOPES.size)
    }
}
