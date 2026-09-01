package com.enat.app.ui.verse

import com.enat.app.data.verse.Verse

/**
 * The verse screen's single source of truth (TICKET-205): sealed state emitted by
 * [VerseViewModel], rendered by a stateless composable — the app-wide shape.
 *
 * There is no Empty state (the backend always answers with a verse, falling back
 * to a bundled one) and no inline notice: the verse changes once a day, so a
 * failed background revalidation over a cached verse simply keeps showing it —
 * offline with a cache is a normal day, not something to warn about.
 */
sealed interface VerseUiState {
    /** First open with an empty cache: «ጥቅሱ በመጫን ላይ ነው…». */
    data object Loading : VerseUiState

    /** The verse (from cache or network), with its display-ready date line. */
    data class Content(
        val verse: Verse,
        val dateText: String,
    ) : VerseUiState

    /** Nothing to show at all: no cache and the fetch failed. */
    data class Error(
        val kind: VerseErrorKind,
    ) : VerseUiState
}

enum class VerseErrorKind { OFFLINE, GENERIC }

/** One-shot effects the verse route performs. */
sealed interface VerseEvent {
    /** The session is dead — only the setup flow's sign-in can fix it. */
    data object NavigateToSetup : VerseEvent
}
