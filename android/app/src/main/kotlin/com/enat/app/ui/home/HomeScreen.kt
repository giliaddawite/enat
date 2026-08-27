package com.enat.app.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.enat.app.R
import com.enat.app.data.greeting.TimeOfDay

/** Stateful entry point: owns the ViewModel, hoists state, forwards events. */
@Composable
fun HomeRoute(viewModel: HomeViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    HomeScreen(uiState = uiState, onRefresh = viewModel::refresh)
}

/** Stateless rendering of [HomeUiState] — all logic lives in [HomeViewModel]. */
@Composable
fun HomeScreen(
    uiState: HomeUiState,
    onRefresh: () -> Unit,
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
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = stringResource(R.string.app_name),
                style = MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.primary,
                textAlign = TextAlign.Center,
            )
            when (uiState) {
                HomeUiState.Loading -> LoadingContent()
                is HomeUiState.Greeting -> GreetingContent(uiState.timeOfDay, onRefresh)
                HomeUiState.Error -> ErrorContent(onRefresh)
            }
        }
    }
}

@Composable
private fun LoadingContent() {
    // A spinner never appears without words (Accessibility § CLAUDE.md).
    Text(
        text = stringResource(R.string.home_loading),
        style = MaterialTheme.typography.titleLarge,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 24.dp),
    )
    CircularProgressIndicator(
        modifier =
            Modifier
                .padding(top = 24.dp)
                .size(64.dp)
                // The loading text above is the announcement; the spinner is decoration.
                .clearAndSetSemantics { },
    )
}

@Composable
private fun GreetingContent(
    timeOfDay: TimeOfDay,
    onRefresh: () -> Unit,
) {
    val greetingRes =
        when (timeOfDay) {
            TimeOfDay.MORNING -> R.string.home_greeting_morning
            TimeOfDay.AFTERNOON -> R.string.home_greeting_afternoon
            TimeOfDay.EVENING -> R.string.home_greeting_evening
        }
    Text(
        text = stringResource(greetingRes),
        style = MaterialTheme.typography.headlineLarge,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .padding(top = 24.dp)
                .testTag("home_greeting"),
    )
    RefreshButton(
        label = stringResource(R.string.home_refresh_button),
        description = stringResource(R.string.home_refresh_content_description),
        onClick = onRefresh,
    )
}

@Composable
private fun ErrorContent(onRefresh: () -> Unit) {
    Text(
        text = stringResource(R.string.home_error),
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.error,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .padding(top = 24.dp)
                .testTag("home_error"),
    )
    RefreshButton(
        label = stringResource(R.string.home_retry_button),
        description = stringResource(R.string.home_retry_content_description),
        onClick = onRefresh,
    )
}

@Composable
private fun RefreshButton(
    label: String,
    description: String,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        modifier =
            Modifier
                .padding(top = 32.dp)
                .fillMaxWidth()
                // 64dp minimum touch target — deliberately above the 48dp guideline.
                .heightIn(min = 64.dp)
                .semantics { contentDescription = description },
    ) {
        Text(text = label, style = MaterialTheme.typography.labelLarge)
    }
}
