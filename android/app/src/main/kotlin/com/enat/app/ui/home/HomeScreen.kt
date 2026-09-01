package com.enat.app.ui.home

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import com.enat.app.BuildConfig
import com.enat.app.R
import com.enat.app.data.greeting.TimeOfDay
import com.enat.app.ui.common.dialPhoneNumber
import com.enat.app.ui.components.PrimaryActionButton

/** Stateful entry point: owns the ViewModel, hoists state, forwards events. */
@Composable
fun HomeRoute(
    onOpenDigest: () -> Unit,
    onOpenVerse: () -> Unit,
    onOpenFamilyPicker: () -> Unit,
    onOpenSettings: () -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                is HomeEvent.DialFamily -> dialPhoneNumber(context, event.phoneNumber)
                HomeEvent.OpenFamilyPicker -> onOpenFamilyPicker()
            }
        }
    }
    HomeScreen(
        uiState = uiState,
        onOpenDigest = onOpenDigest,
        onOpenVerse = onOpenVerse,
        onCallFamily = viewModel::onCallFamily,
        onOpenSettings = onOpenSettings,
    )
}

/** Stateless rendering of [HomeUiState] — all logic lives in [HomeViewModel]. */
@Composable
fun HomeScreen(
    uiState: HomeUiState,
    onOpenDigest: () -> Unit,
    onOpenVerse: () -> Unit,
    onCallFamily: () -> Unit,
    onOpenSettings: () -> Unit,
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
        ) {
            when (uiState) {
                HomeUiState.Loading -> LoadingContent()
                is HomeUiState.Hub ->
                    HubContent(
                        state = uiState,
                        onOpenDigest = onOpenDigest,
                        onOpenVerse = onOpenVerse,
                        onCallFamily = onCallFamily,
                        onOpenSettings = onOpenSettings,
                    )
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
private fun HubContent(
    state: HomeUiState.Hub,
    onOpenDigest: () -> Unit,
    onOpenVerse: () -> Unit,
    onCallFamily: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val greetingRes =
        when (state.timeOfDay) {
            TimeOfDay.MORNING -> R.string.home_greeting_morning
            TimeOfDay.AFTERNOON -> R.string.home_greeting_afternoon
            TimeOfDay.EVENING -> R.string.home_greeting_evening
        }
    Text(
        text = stringResource(greetingRes),
        style = MaterialTheme.typography.headlineMedium,
        color = MaterialTheme.colorScheme.primary,
        textAlign = TextAlign.Center,
        modifier = Modifier.testTag("hub_greeting"),
    )
    Text(
        text = state.dateText,
        style = MaterialTheme.typography.headlineLarge,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .padding(top = 8.dp)
                .testTag("hub_date"),
    )
    Text(
        text = state.timeText,
        style = MaterialTheme.typography.displayMedium,
        textAlign = TextAlign.Center,
        modifier = Modifier.testTag("hub_time"),
    )
    Spacer(modifier = Modifier.height(24.dp))
    // Focus order = column order: greeting, date/time, then the three actions —
    // TalkBack walks them top to bottom. Each action is one tap from launch.
    PrimaryActionButton(
        label = stringResource(R.string.hub_button_digest),
        onClick = onOpenDigest,
        minHeight = HUB_BUTTON_MIN_HEIGHT,
        textStyle = MaterialTheme.typography.headlineMedium,
        modifier = Modifier.padding(top = 16.dp),
    )
    PrimaryActionButton(
        label = stringResource(R.string.hub_button_verse),
        onClick = onOpenVerse,
        minHeight = HUB_BUTTON_MIN_HEIGHT,
        textStyle = MaterialTheme.typography.headlineMedium,
        modifier = Modifier.padding(top = 16.dp),
    )
    PrimaryActionButton(
        label = stringResource(R.string.hub_button_call),
        onClick = onCallFamily,
        minHeight = HUB_BUTTON_MIN_HEIGHT,
        textStyle = MaterialTheme.typography.headlineMedium,
        modifier = Modifier.padding(top = 16.dp),
    )
    if (state.showCallNotConfigured) {
        Text(
            text = stringResource(R.string.hub_call_not_configured),
            style = MaterialTheme.typography.titleLarge,
            color = MaterialTheme.colorScheme.error,
            textAlign = TextAlign.Center,
            modifier =
                Modifier
                    .padding(top = 16.dp)
                    .testTag("hub_call_not_configured")
                    // Appears in response to a tap; announce it without stealing focus.
                    .semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
    Spacer(modifier = Modifier.height(32.dp))
    VersionFooter(onOpenSettings = onOpenSettings)
}

/**
 * Deliberate exception to the "no gesture-only interactions" rule: the long-press
 * on the version text is the CAREGIVER'S hidden entry into quick-dial settings
 * (TICKET-203), intentionally invisible to the end user so the hub stays three
 * buttons and nothing else. Every END-USER action on this screen is a plain tap;
 * once opened, the settings screen itself gets full accessibility treatment.
 * TalkBack still exposes the long-press as a labeled custom action, so the entry
 * is discoverable by an assistive-tech-using caregiver too.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun VersionFooter(onOpenSettings: () -> Unit) {
    Text(
        text = stringResource(R.string.hub_version, BuildConfig.VERSION_NAME),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .testTag("hub_version")
                .heightIn(min = 64.dp)
                // Both axes meet the 64dp floor even if the version string is short.
                .widthIn(min = 64.dp)
                .combinedClickable(
                    // A stray single tap must do nothing — only the deliberate
                    // long-press opens settings.
                    onClick = {},
                    onLongClick = onOpenSettings,
                    onLongClickLabel = stringResource(R.string.hub_open_settings_action),
                )
                .padding(12.dp)
                .wrapContentHeight(),
    )
}

private val HUB_BUTTON_MIN_HEIGHT = 96.dp
