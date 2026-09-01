package com.enat.app.ui.digest

import com.enat.app.data.digest.Digest

/**
 * The digest screen's single source of truth (TICKET-204): sealed state emitted by
 * [DigestViewModel], rendered by a stateless composable — the app-wide shape.
 */
sealed interface DigestUiState {
    /** Which self-explaining Amharic message the full-screen wait shows. */
    enum class LoadingKind {
        /** First open with an empty cache: «በመጫን ላይ…». */
        LOADING,

        /** On-demand generation is running: «ማጠቃለያው በመዘጋጀት ላይ…». */
        GENERATING,
    }

    data class Loading(
        val kind: LoadingKind,
    ) : DigestUiState

    /** The digest (from cache or network); a refresh may be running behind it. */
    data class Content(
        val digest: Digest,
        val refreshing: Boolean,
        val notice: DigestNotice? = null,
    ) : DigestUiState

    /** A digest exists but holds no mail — «ዛሬ አዲስ መልእክት የለም». */
    data class Empty(
        val refreshing: Boolean = false,
        val notice: DigestNotice? = null,
    ) : DigestUiState

    /** Nothing to show at all: no cache and the fetch failed. */
    data class Error(
        val kind: DigestErrorKind,
    ) : DigestUiState

    /** 409 gmail_reconnect_required — the ReconnectCard takes over the screen. */
    data object ReconnectRequired : DigestUiState
}

/**
 * Inline notice above content. OFFLINE/REFRESH_FAILED say why the cache is what's
 * showing; REFRESHED confirms a user-initiated refresh succeeded — success must be
 * announced just as loudly as failure (TalkBack hears the polite live region).
 */
enum class DigestNotice { OFFLINE, REFRESH_FAILED, REFRESHED }

enum class DigestErrorKind { OFFLINE, GENERIC }

/** One-shot effects the digest route performs. */
sealed interface DigestEvent {
    /** Signed out or Gmail never connected — only the setup flow can fix either. */
    data object NavigateToSetup : DigestEvent
}
