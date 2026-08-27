package com.enat.app.ui.setup

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.enat.app.R
import com.enat.app.ui.components.PrimaryActionButton
import com.enat.app.ui.components.ReconnectCard

/** Stateful entry point: owns the ViewModel, hoists state, forwards events. */
@Composable
fun SetupRoute(
    onSetupFinished: () -> Unit,
    viewModel: SetupViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val consentLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
            viewModel.onConsentResult(result.resultCode, result.data)
        }
    val state = uiState
    if (state is SetupUiState.AwaitingConsent) {
        // Keyed on the state instance: Google's consent screen launches once per
        // ConsentRequired emission, never again on recomposition.
        LaunchedEffect(state) { state.prompt.launch(consentLauncher) }
    }
    val activity = LocalContext.current.findActivity()
    SetupScreen(
        uiState = uiState,
        onSignIn = { viewModel.startSignIn(activity) },
        onRetry = { viewModel.retry(activity) },
        onDone = onSetupFinished,
    )
}

private tailrec fun Context.findActivity(): Activity =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> error("SetupRoute must be hosted in an Activity")
    }

/** Stateless rendering of [SetupUiState] — all logic lives in [SetupViewModel]. */
@Composable
fun SetupScreen(
    uiState: SetupUiState,
    onSignIn: () -> Unit,
    onRetry: () -> Unit,
    onDone: () -> Unit,
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
            Text(
                text = stringResource(R.string.setup_title),
                style = MaterialTheme.typography.displaySmall,
                color = MaterialTheme.colorScheme.primary,
                textAlign = TextAlign.Center,
            )
            StepList(currentStep = currentStep(uiState))
            when (uiState) {
                SetupUiState.ConfigMissing -> ConfigMissingContent()
                SetupUiState.SignInStep -> SignInContent(onSignIn)
                SetupUiState.SigningIn -> ProgressContent(R.string.setup_status_signing_in)
                SetupUiState.Authorizing, is SetupUiState.AwaitingConsent ->
                    ProgressContent(R.string.setup_status_authorizing)
                SetupUiState.Connecting -> ProgressContent(R.string.setup_status_connecting)
                SetupUiState.Success -> SuccessContent(onDone)
                is SetupUiState.Error -> ErrorContent(uiState.kind, onRetry)
            }
        }
    }
}

/** Which of the three numbered steps the state belongs to, for the step list. */
private fun currentStep(uiState: SetupUiState): Int =
    when (uiState) {
        SetupUiState.ConfigMissing, SetupUiState.SignInStep, SetupUiState.SigningIn -> 1
        SetupUiState.Authorizing, is SetupUiState.AwaitingConsent -> 2
        SetupUiState.Connecting, SetupUiState.Success -> 3
        is SetupUiState.Error ->
            when (uiState.kind) {
                SetupErrorKind.SIGN_IN_FAILED -> 1
                // no_refresh_token is reported by step 3 but fixed by redoing step 2.
                SetupErrorKind.AUTHORIZATION_FAILED,
                SetupErrorKind.SCOPES_MISSING,
                SetupErrorKind.NO_REFRESH_TOKEN,
                -> 2
                SetupErrorKind.CONNECTION_FAILED -> 3
            }
    }

@Composable
private fun StepList(currentStep: Int) {
    val steps =
        listOf(
            R.string.setup_step_sign_in,
            R.string.setup_step_gmail,
            R.string.setup_step_connect,
        )
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(top = 24.dp),
    ) {
        steps.forEachIndexed { index, labelRes ->
            val isCurrent = index + 1 == currentStep
            Text(
                text = stringResource(labelRes),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                color =
                    if (isCurrent) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.onBackground
                    },
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}

@Composable
private fun SignInContent(onSignIn: () -> Unit) {
    Text(
        text = stringResource(R.string.setup_intro),
        style = MaterialTheme.typography.titleLarge,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 24.dp),
    )
    PrimaryActionButton(
        label = stringResource(R.string.setup_sign_in_button),
        onClick = onSignIn,
        modifier = Modifier.padding(top = 32.dp),
    )
}

@Composable
private fun ProgressContent(
    @StringRes messageRes: Int,
) {
    // A spinner never appears without words (Accessibility § CLAUDE.md).
    Text(
        text = stringResource(messageRes),
        style = MaterialTheme.typography.titleLarge,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 24.dp),
    )
    CircularProgressIndicator(
        modifier =
            Modifier
                .padding(top = 24.dp)
                .size(64.dp)
                // The status text above is the announcement; the spinner is decoration.
                .clearAndSetSemantics { },
    )
}

@Composable
private fun SuccessContent(onDone: () -> Unit) {
    Text(
        text = stringResource(R.string.setup_success_title),
        style = MaterialTheme.typography.headlineMedium,
        color = MaterialTheme.colorScheme.primary,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .padding(top = 24.dp)
                .testTag("setup_success"),
    )
    Text(
        text = stringResource(R.string.setup_success_body),
        style = MaterialTheme.typography.titleLarge,
        textAlign = TextAlign.Center,
        modifier = Modifier.padding(top = 16.dp),
    )
    PrimaryActionButton(
        label = stringResource(R.string.setup_done_button),
        onClick = onDone,
        modifier = Modifier.padding(top = 32.dp),
    )
}

@Composable
private fun ErrorContent(
    kind: SetupErrorKind,
    onRetry: () -> Unit,
) {
    when (kind) {
        // The backend could not keep a refresh token — the same "grant access again"
        // situation future screens surface with ReconnectCard, so setup reuses it.
        SetupErrorKind.NO_REFRESH_TOKEN ->
            ReconnectCard(
                onReconnect = onRetry,
                modifier = Modifier.padding(top = 24.dp),
            )
        SetupErrorKind.SIGN_IN_FAILED -> RetryableError(R.string.setup_error_sign_in, onRetry)
        SetupErrorKind.AUTHORIZATION_FAILED -> RetryableError(R.string.setup_error_authorization, onRetry)
        SetupErrorKind.SCOPES_MISSING -> RetryableError(R.string.setup_error_scopes, onRetry)
        SetupErrorKind.CONNECTION_FAILED -> RetryableError(R.string.setup_error_connection, onRetry)
    }
}

@Composable
private fun RetryableError(
    @StringRes messageRes: Int,
    onRetry: () -> Unit,
) {
    Text(
        text = stringResource(messageRes),
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.error,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .padding(top = 24.dp)
                .testTag("setup_error"),
    )
    PrimaryActionButton(
        label = stringResource(R.string.setup_retry_button),
        onClick = onRetry,
        modifier = Modifier.padding(top = 32.dp),
    )
}

@Composable
private fun ConfigMissingContent() {
    Text(
        text = stringResource(R.string.setup_error_config),
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.error,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .padding(top = 24.dp)
                .testTag("setup_config_error"),
    )
}
