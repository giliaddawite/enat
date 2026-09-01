package com.enat.app.ui.verse

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.enat.app.R
import com.enat.app.data.verse.Verse
import com.enat.app.ui.components.BackButton
import com.enat.app.ui.components.PrimaryActionButton

/** Stateful entry point: owns the ViewModel, hoists state, forwards events. */
@Composable
fun VerseRoute(
    onBack: () -> Unit,
    onNavigateToSetup: () -> Unit,
    viewModel: VerseViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                VerseEvent.NavigateToSetup -> onNavigateToSetup()
            }
        }
    }
    VerseScreen(
        uiState = uiState,
        onBack = onBack,
        onRetry = viewModel::load,
    )
}

/** Stateless rendering of [VerseUiState] — all logic lives in [VerseViewModel]. */
@Composable
fun VerseScreen(
    uiState: VerseUiState,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(modifier = modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    // Must survive the maximum system font size without clipping.
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 24.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(top = 16.dp),
            ) {
                BackButton(onBack = onBack)
                Text(
                    text = stringResource(R.string.verse_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            when (uiState) {
                VerseUiState.Loading -> LoadingContent()
                is VerseUiState.Content -> VerseContent(verse = uiState.verse, dateText = uiState.dateText)
                is VerseUiState.Error -> ErrorContent(uiState.kind, onRetry)
            }
        }
    }
}

@Composable
private fun LoadingContent() {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // A spinner never appears without words (Accessibility § CLAUDE.md).
        Text(
            text = stringResource(R.string.verse_loading),
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
            modifier =
                Modifier
                    .padding(top = 48.dp)
                    .testTag("verse_loading")
                    // The loading → content transition announces itself.
                    .semantics { liveRegion = LiveRegionMode.Polite },
        )
        CircularProgressIndicator(
            modifier =
                Modifier
                    .padding(top = 24.dp)
                    .size(64.dp)
                    // The text above is the announcement; the spinner is decoration.
                    .clearAndSetSemantics { },
        )
    }
}

/**
 * The large-type verse card: Amharic text first, then its reference — quote before
 * attribution, which is also the order TalkBack reads (traversal follows the visual
 * top-to-bottom order). The English pair follows, smaller, below a divider.
 */
@Composable
private fun VerseContent(
    verse: Verse,
    dateText: String,
) {
    Text(
        text = dateText,
        style = MaterialTheme.typography.titleMedium,
        modifier =
            Modifier
                .padding(top = 16.dp)
                .testTag("verse_date"),
    )
    Card(
        colors =
            CardDefaults.cardColors(
                // Audited surfaceVariant/onSurfaceVariant pair (Theme.kt).
                containerColor = MaterialTheme.colorScheme.surfaceVariant,
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(top = 16.dp)
                .testTag("verse_card"),
    ) {
        Column(modifier = Modifier.padding(24.dp)) {
            Text(
                // The Amharic verse is the screen's content — the biggest audited
                // role that a multi-line verse can carry without crowding out its
                // reference at maximum font scale.
                text = verse.textAm,
                style = MaterialTheme.typography.headlineLarge,
            )
            Text(
                text = verse.referenceAm,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 16.dp),
            )
            HorizontalDivider(
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(top = 24.dp),
            )
            Text(
                text = verse.textEn,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 24.dp),
            )
            Text(
                text = verse.reference,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun ErrorContent(
    kind: VerseErrorKind,
    onRetry: () -> Unit,
) {
    val messageRes =
        when (kind) {
            VerseErrorKind.OFFLINE -> R.string.verse_error_offline
            VerseErrorKind.GENERIC -> R.string.verse_error_generic
        }
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stringResource(messageRes),
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.error,
            textAlign = TextAlign.Center,
            modifier =
                Modifier
                    .padding(top = 48.dp)
                    .testTag("verse_error")
                    .semantics { liveRegion = LiveRegionMode.Polite },
        )
        PrimaryActionButton(
            label = stringResource(R.string.verse_retry_button),
            onClick = onRetry,
            modifier = Modifier.padding(top = 32.dp),
        )
    }
}
