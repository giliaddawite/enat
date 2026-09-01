package com.enat.app.ui.verse

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.enat.app.data.verse.Verse
import com.enat.app.data.verse.VerseRepository
import com.enat.app.data.verse.VerseSyncResult
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale
import javax.inject.Inject

@HiltViewModel
class VerseViewModel
    @Inject
    constructor(
        private val repository: VerseRepository,
    ) : ViewModel() {
        private val _uiState = MutableStateFlow<VerseUiState>(VerseUiState.Loading)
        val uiState: StateFlow<VerseUiState> = _uiState.asStateFlow()

        private val _events = Channel<VerseEvent>(Channel.BUFFERED)
        val events: Flow<VerseEvent> = _events.receiveAsFlow()

        init {
            load()
        }

        /**
         * Cache first — the screen renders the saved verse immediately, offline
         * included — then revalidates over the network with ETag. The verse only
         * changes once a day, so revalidation is silent: no refreshing indicator,
         * no notice when it fails over a cache.
         */
        fun load() {
            viewModelScope.launch {
                val cached = repository.cachedVerse()
                if (cached != null) {
                    _uiState.value = contentFor(cached)
                }
                apply(repository.fetchToday(), cached)
            }
        }

        private suspend fun apply(
            result: VerseSyncResult,
            cached: Verse?,
        ) {
            when (result) {
                is VerseSyncResult.Success -> _uiState.value = contentFor(result.verse)
                VerseSyncResult.NotModified ->
                    // A 304 can only follow an If-None-Match, which only a cache provides.
                    cached?.let { _uiState.value = contentFor(it) }
                VerseSyncResult.SignedOut -> {
                    if (cached == null) {
                        // Leave a retryable state behind in case navigation is interrupted.
                        _uiState.value = VerseUiState.Error(VerseErrorKind.GENERIC)
                        _events.send(VerseEvent.NavigateToSetup)
                    } else {
                        // The cached verse is still today's best answer; the digest
                        // screen (or the next app start) is where the session gets fixed.
                        _uiState.value = contentFor(cached)
                    }
                }
                VerseSyncResult.Offline ->
                    if (cached == null) {
                        _uiState.value = VerseUiState.Error(VerseErrorKind.OFFLINE)
                    }
                VerseSyncResult.Failed ->
                    if (cached == null) {
                        _uiState.value = VerseUiState.Error(VerseErrorKind.GENERIC)
                    }
            }
        }

        private fun contentFor(verse: Verse): VerseUiState.Content =
            VerseUiState.Content(verse = verse, dateText = formatDate(verse.date))

        /**
         * Device-locale formatting of the backend's date key, matching the hub's
         * date line (HomeViewModel) — with the phone set to Amharic this localizes
         * automatically. An unparseable key falls back to itself: a wrong-looking
         * date must never take the verse down with it.
         */
        private fun formatDate(dateKey: String): String =
            try {
                LocalDate
                    .parse(dateKey)
                    .format(DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(Locale.getDefault()))
            } catch (unparseable: DateTimeParseException) {
                dateKey
            }
    }
