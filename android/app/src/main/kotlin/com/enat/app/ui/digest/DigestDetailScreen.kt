package com.enat.app.ui.digest

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.enat.app.R
import com.enat.app.data.digest.DigestItem
import com.enat.app.ui.common.openMessageInGmail
import com.enat.app.ui.components.BackButton
import com.enat.app.ui.components.PrimaryActionButton

/** Stateful entry point: owns the ViewModel, hoists state, forwards events. */
@Composable
fun DigestDetailRoute(
    onBack: () -> Unit,
    viewModel: DigestDetailViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    DigestDetailScreen(
        uiState = uiState,
        onOpenInGmail = { messageId -> openMessageInGmail(context, messageId) },
        onBack = onBack,
    )
}

/** Stateless rendering of [DigestDetailUiState]: sender, full summary, category, Gmail link. */
@Composable
fun DigestDetailScreen(
    uiState: DigestDetailUiState,
    onOpenInGmail: (String) -> Unit,
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
                    text = stringResource(R.string.detail_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            when (uiState) {
                DigestDetailUiState.Loading ->
                    Text(
                        text = stringResource(R.string.digest_loading),
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.padding(top = 24.dp),
                    )
                DigestDetailUiState.Missing ->
                    Text(
                        text = stringResource(R.string.detail_not_found),
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.error,
                        modifier =
                            Modifier
                                .padding(top = 24.dp)
                                .testTag("detail_missing"),
                    )
                is DigestDetailUiState.Detail -> DetailContent(uiState.item, onOpenInGmail)
            }
        }
    }
}

@Composable
private fun DetailContent(
    item: DigestItem,
    onOpenInGmail: (String) -> Unit,
) {
    LabeledField(labelRes = R.string.detail_sender_label, value = item.sender)
    LabeledField(labelRes = R.string.detail_subject_label, value = item.subject)
    LabeledField(
        labelRes = R.string.detail_category_label,
        value = stringResource(item.category.labelRes()),
    )
    if (item.urgent) {
        UrgentBadge(modifier = Modifier.padding(top = 16.dp))
    }
    Text(
        text = item.summary ?: stringResource(R.string.detail_no_summary),
        style = MaterialTheme.typography.headlineSmall,
        modifier =
            Modifier
                .padding(top = 24.dp)
                .testTag("detail_summary"),
    )
    PrimaryActionButton(
        label = stringResource(R.string.detail_open_gmail_button),
        onClick = { onOpenInGmail(item.messageId) },
        modifier = Modifier.padding(top = 32.dp),
    )
}

@Composable
private fun LabeledField(
    labelRes: Int,
    value: String,
) {
    Text(
        text = stringResource(labelRes),
        style = MaterialTheme.typography.titleMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 20.dp),
    )
    Text(
        text = value,
        style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.Medium,
    )
}
