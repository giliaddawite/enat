package com.enat.app.ui.digest

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.enat.app.R
import com.enat.app.data.digest.Digest
import com.enat.app.data.digest.DigestItem
import com.enat.app.data.digest.EmailCategory
import com.enat.app.ui.components.BackButton
import com.enat.app.ui.components.PrimaryActionButton
import com.enat.app.ui.components.ReconnectCard

/** Stateful entry point: owns the ViewModel, hoists state, forwards events. */
@Composable
fun DigestRoute(
    onBack: () -> Unit,
    onOpenDetail: (String) -> Unit,
    onReconnect: () -> Unit,
    onNavigateToSetup: () -> Unit,
    viewModel: DigestViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) {
        viewModel.events.collect { event ->
            when (event) {
                DigestEvent.NavigateToSetup -> onNavigateToSetup()
            }
        }
    }
    DigestScreen(
        uiState = uiState,
        onBack = onBack,
        onOpenDetail = onOpenDetail,
        onRefresh = viewModel::refresh,
        onReconnect = onReconnect,
    )
}

/** Stateless rendering of [DigestUiState] — all logic lives in [DigestViewModel]. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DigestScreen(
    uiState: DigestUiState,
    onBack: () -> Unit,
    onOpenDetail: (String) -> Unit,
    onRefresh: () -> Unit,
    onReconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(modifier = modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(modifier = Modifier.fillMaxSize().padding(horizontal = 24.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(top = 16.dp),
            ) {
                BackButton(onBack = onBack)
                Text(
                    text = stringResource(R.string.digest_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            when (uiState) {
                is DigestUiState.Loading -> LoadingContent(uiState.kind)
                is DigestUiState.Content ->
                    DigestContent(
                        digest = uiState.digest,
                        refreshing = uiState.refreshing,
                        notice = uiState.notice,
                        onOpenDetail = onOpenDetail,
                        onRefresh = onRefresh,
                    )
                is DigestUiState.Empty ->
                    EmptyContent(
                        refreshing = uiState.refreshing,
                        notice = uiState.notice,
                        onRefresh = onRefresh,
                    )
                is DigestUiState.Error -> ErrorContent(uiState.kind, onRefresh)
                DigestUiState.ReconnectRequired ->
                    Column(
                        modifier =
                            Modifier
                                .fillMaxSize()
                                // ReconnectCard requires a scrolling host (font-size max).
                                .verticalScroll(rememberScrollState()),
                    ) {
                        ReconnectCard(
                            onReconnect = onReconnect,
                            modifier = Modifier.padding(top = 24.dp),
                        )
                    }
            }
        }
    }
}

@Composable
private fun LoadingContent(kind: DigestUiState.LoadingKind) {
    val messageRes =
        when (kind) {
            DigestUiState.LoadingKind.LOADING -> R.string.digest_loading
            DigestUiState.LoadingKind.GENERATING -> R.string.digest_generating
        }
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // A spinner never appears without words (Accessibility § CLAUDE.md).
        Text(
            text = stringResource(messageRes),
            style = MaterialTheme.typography.titleLarge,
            textAlign = TextAlign.Center,
            modifier =
                Modifier
                    .padding(top = 48.dp)
                    .testTag("digest_loading")
                    // Loading → generating transitions announce themselves.
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DigestContent(
    digest: Digest,
    refreshing: Boolean,
    notice: DigestNotice?,
    onOpenDetail: (String) -> Unit,
    onRefresh: () -> Unit,
) {
    RefreshHeader(refreshing = refreshing, notice = notice, onRefresh = onRefresh)
    // Pull-to-refresh is a redundant convenience on top of the visible button —
    // never the only path (no gesture-only interactions § CLAUDE.md).
    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize(),
    ) {
        LazyColumn(modifier = Modifier.fillMaxSize().testTag("digest_list")) {
            digest.sections.forEach { section ->
                item(key = "section-${section.category.wireId}") {
                    Text(
                        text = stringResource(section.category.labelRes()),
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(top = 24.dp),
                    )
                }
                items(section.items.size, key = { index -> section.items[index].messageId }) { index ->
                    EmailCard(item = section.items[index], onOpenDetail = onOpenDetail)
                }
            }
        }
    }
}

@Composable
private fun RefreshHeader(
    refreshing: Boolean,
    notice: DigestNotice?,
    onRefresh: () -> Unit,
) {
    PrimaryActionButton(
        label = stringResource(R.string.digest_refresh_button),
        onClick = onRefresh,
        modifier = Modifier.padding(top = 16.dp),
    )
    if (refreshing) {
        Text(
            text = stringResource(R.string.digest_refreshing),
            style = MaterialTheme.typography.titleMedium,
            modifier =
                Modifier
                    .padding(top = 8.dp)
                    .testTag("digest_refreshing")
                    .semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
    if (notice != null) {
        val noticeRes =
            when (notice) {
                DigestNotice.OFFLINE -> R.string.digest_notice_offline
                DigestNotice.REFRESH_FAILED -> R.string.digest_notice_refresh_failed
                DigestNotice.REFRESHED -> R.string.digest_refreshed
            }
        Text(
            text = stringResource(noticeRes),
            style = MaterialTheme.typography.titleMedium,
            // Success in the calm primary green, problems in error red — and the
            // text itself carries the meaning either way, never the color alone.
            color =
                if (notice == DigestNotice.REFRESHED) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.error
                },
            modifier =
                Modifier
                    .padding(top = 8.dp)
                    .testTag("digest_notice")
                    // Mirrors SetupScreen's SuccessContent: outcome announcements
                    // are polite live regions, success and failure alike.
                    .semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

@Composable
private fun EmailCard(
    item: DigestItem,
    onOpenDetail: (String) -> Unit,
) {
    Card(
        onClick = { onOpenDetail(item.messageId) },
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
                .testTag("digest_card_${item.messageId}"),
    ) {
        Column(modifier = Modifier.padding(20.dp)) {
            Text(
                text = item.sender,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                // Category-only results have no summary; the subject is the next best line.
                text = item.summary ?: item.subject,
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 8.dp),
            )
            if (item.urgent) {
                UrgentBadge(modifier = Modifier.padding(top = 12.dp))
            }
        }
    }
}

/** Never color-only: icon + «አስቸኳይ» text carry the meaning, color reinforces it. */
@Composable
fun UrgentBadge(modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        shape = MaterialTheme.shapes.small,
        modifier = modifier,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Warning,
                // The text alongside carries the meaning for TalkBack.
                contentDescription = null,
                modifier = Modifier.size(24.dp),
            )
            Text(
                text = stringResource(R.string.digest_urgent_badge),
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(start = 8.dp),
            )
        }
    }
}

@Composable
private fun EmptyContent(
    refreshing: Boolean,
    notice: DigestNotice?,
    onRefresh: () -> Unit,
) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
    ) {
        RefreshHeader(refreshing = refreshing, notice = notice, onRefresh = onRefresh)
        Text(
            text = stringResource(R.string.digest_empty),
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(top = 48.dp)
                    .testTag("digest_empty")
                    // The empty answer often replaces a loading state — TalkBack
                    // must hear that the wait ended in "no new mail today".
                    .semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}

@Composable
private fun ErrorContent(
    kind: DigestErrorKind,
    onRefresh: () -> Unit,
) {
    val messageRes =
        when (kind) {
            DigestErrorKind.OFFLINE -> R.string.digest_error_offline
            DigestErrorKind.GENERIC -> R.string.digest_error_generic
        }
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
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
                    .testTag("digest_error")
                    .semantics { liveRegion = LiveRegionMode.Polite },
        )
        PrimaryActionButton(
            label = stringResource(R.string.digest_retry_button),
            onClick = onRefresh,
            modifier = Modifier.padding(top = 32.dp),
        )
    }
}

@StringRes
fun EmailCategory.labelRes(): Int =
    when (this) {
        EmailCategory.IMPORTANT -> R.string.category_important
        EmailCategory.BILLS_ACCOUNTS -> R.string.category_bills_accounts
        EmailCategory.FAMILY_PERSONAL -> R.string.category_family_personal
        EmailCategory.PROMOTIONS_OTHER -> R.string.category_promotions_other
    }
