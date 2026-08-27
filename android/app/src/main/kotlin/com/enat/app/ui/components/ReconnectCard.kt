package com.enat.app.ui.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.enat.app.R

/**
 * Reusable "Gmail needs to be reconnected" card. Screens show it whenever the
 * backend answers with [com.enat.app.data.auth.ApiErrorCode.GMAIL_RECONNECT_REQUIRED]
 * (and the setup flow reuses it for no_refresh_token — the same "grant access
 * again" situation). [onReconnect] must re-run the Gmail consent flow.
 *
 * The card deliberately does not scroll itself: hosts must place it inside a
 * scrolling container (as SetupScreen does) so it survives the maximum system
 * font size without clipping.
 */
@Composable
fun ReconnectCard(
    onReconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag("reconnect_card"),
        colors =
            CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.errorContainer,
                contentColor = MaterialTheme.colorScheme.onErrorContainer,
            ),
    ) {
        Column(modifier = Modifier.padding(24.dp)) {
            Text(
                text = stringResource(R.string.reconnect_title),
                style = MaterialTheme.typography.titleLarge,
                // The card appears in place of other content; announce it politely.
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            Text(
                text = stringResource(R.string.reconnect_body),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 12.dp),
            )
            PrimaryActionButton(
                label = stringResource(R.string.reconnect_button),
                onClick = onReconnect,
                modifier = Modifier.padding(top = 24.dp),
                colors =
                    ButtonDefaults.buttonColors(
                        // Audited error/onError pair (Theme.kt): the default green
                        // primary would clash on the red errorContainer card.
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
            )
        }
    }
}
