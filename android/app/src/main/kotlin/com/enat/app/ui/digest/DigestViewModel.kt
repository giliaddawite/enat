package com.enat.app.ui.digest

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.enat.app.data.digest.Digest
import com.enat.app.data.digest.DigestRepository
import com.enat.app.data.digest.DigestSyncResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class DigestViewModel
    @Inject
    constructor(
        private val repository: DigestRepository,
    ) : ViewModel() {
        private val _uiState =
            MutableStateFlow<DigestUiState>(DigestUiState.Loading(DigestUiState.LoadingKind.LOADING))
        val uiState: StateFlow<DigestUiState> = _uiState.asStateFlow()

        private val _events = Channel<DigestEvent>(Channel.BUFFERED)
        val events: Flow<DigestEvent> = _events.receiveAsFlow()

        /** One automatic generate per screen life — a failing backend must not loop. */
        private var autoGenerateAttempted = false

        init {
            load()
        }

        /**
         * Cache first — the screen renders saved mail immediately (the <500ms
         * open-to-content criterion) — then revalidates over the network with ETag.
         */
        fun load() {
            viewModelScope.launch {
                val cached = repository.cachedDigest()
                _uiState.value =
                    if (cached != null) {
                        stateFor(cached, refreshing = true)
                    } else {
                        DigestUiState.Loading(DigestUiState.LoadingKind.LOADING)
                    }
                apply(repository.fetchLatest(), cached, userInitiated = false)
            }
        }

        /** The visible refresh button (and pull-to-refresh): generate on demand, then show it. */
        fun refresh() {
            viewModelScope.launch {
                val cached = repository.cachedDigest()
                _uiState.value =
                    if (cached != null) {
                        stateFor(cached, refreshing = true)
                    } else {
                        DigestUiState.Loading(DigestUiState.LoadingKind.GENERATING)
                    }
                apply(repository.regenerate(), cached, userInitiated = true)
            }
        }

        private suspend fun apply(
            result: DigestSyncResult,
            cached: Digest?,
            userInitiated: Boolean,
        ) {
            // A refresh the user asked for confirms its success out loud — silence
            // after a tap reads as failure, on screen and in TalkBack alike.
            val successNotice = if (userInitiated) DigestNotice.REFRESHED else null
            when (result) {
                is DigestSyncResult.Success ->
                    _uiState.value = stateFor(result.digest, refreshing = false, notice = successNotice)
                DigestSyncResult.NotModified ->
                    // A 304 can only follow an If-None-Match, which only a cache provides.
                    cached?.let { _uiState.value = stateFor(it, refreshing = false, notice = successNotice) }
                DigestSyncResult.NoDigestYet -> onNoDigestYet(cached)
                DigestSyncResult.GmailReconnectRequired -> _uiState.value = DigestUiState.ReconnectRequired
                DigestSyncResult.GmailNotConnected, DigestSyncResult.SignedOut -> {
                    // Leave a retryable state behind in case navigation is interrupted.
                    _uiState.value = DigestUiState.Error(DigestErrorKind.GENERIC)
                    _events.send(DigestEvent.NavigateToSetup)
                }
                DigestSyncResult.Offline ->
                    _uiState.value =
                        if (cached != null) {
                            // Airplane mode is a normal day, not an error — only an explicit
                            // refresh that failed earns an inline notice.
                            val notice = if (userInitiated) DigestNotice.OFFLINE else null
                            stateFor(cached, refreshing = false, notice = notice)
                        } else {
                            DigestUiState.Error(DigestErrorKind.OFFLINE)
                        }
                DigestSyncResult.Failed ->
                    _uiState.value =
                        if (cached != null) {
                            stateFor(cached, refreshing = false, notice = DigestNotice.REFRESH_FAILED)
                        } else {
                            DigestUiState.Error(DigestErrorKind.GENERIC)
                        }
            }
        }

        /**
         * 404 means nothing was generated today. With no cache the screen would be
         * blank, so fall back to on-demand generation once (the backend's documented
         * missed-schedule fallback); with a cache, yesterday's mail stays readable and
         * the refresh button offers generation.
         */
        private suspend fun onNoDigestYet(cached: Digest?) {
            if (cached == null && !autoGenerateAttempted) {
                autoGenerateAttempted = true
                _uiState.value = DigestUiState.Loading(DigestUiState.LoadingKind.GENERATING)
                apply(repository.regenerate(), cached = null, userInitiated = false)
            } else if (cached == null) {
                _uiState.value = DigestUiState.Empty()
            } else {
                _uiState.value = stateFor(cached, refreshing = false)
            }
        }

        private fun stateFor(
            digest: Digest,
            refreshing: Boolean,
            notice: DigestNotice? = null,
        ): DigestUiState =
            if (digest.sections.isEmpty()) {
                DigestUiState.Empty(refreshing = refreshing, notice = notice)
            } else {
                DigestUiState.Content(digest = digest, refreshing = refreshing, notice = notice)
            }
    }
