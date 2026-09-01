package com.enat.app.ui.verse

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.enat.app.R
import com.enat.app.ui.components.BackButton

/**
 * Stand-in until TICKET-205 builds the real verse screen. The hub button stays real
 * so the hub layout is final; this screen says in plain Amharic that the verse is
 * on its way.
 */
@Composable
fun VersePlaceholderScreen(
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(modifier = modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    // Must survive the maximum system font size without clipping.
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BackButton(onBack = onBack)
                Text(
                    text = stringResource(R.string.verse_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            Text(
                text = stringResource(R.string.verse_placeholder_body),
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 48.dp),
            )
        }
    }
}
