package com.enat.app.ui.home

import com.enat.app.data.greeting.TimeOfDay

/**
 * The home hub's single source of truth (TICKET-203). Every screen in the app
 * follows this shape: a sealed state the ViewModel emits, rendered by a stateless
 * composable.
 */
sealed interface HomeUiState {
    /** Only visible for the first frame, before the clock flow emits. */
    data object Loading : HomeUiState

    data class Hub(
        val timeOfDay: TimeOfDay,
        /** Formatted by the device locale — Amharic dates come from the locale, never hand-rolled. */
        val dateText: String,
        val timeText: String,
        /** True after «ቤተሰብ ደውል» was tapped with no contact configured yet. */
        val showCallNotConfigured: Boolean,
    ) : HomeUiState
}

/** One-shot effects the hub route performs (dialing, navigation with logic behind it). */
sealed interface HomeEvent {
    /** Exactly one contact is configured — dial it directly (ACTION_DIAL, 1 tap). */
    data class DialFamily(
        val phoneNumber: String,
    ) : HomeEvent

    /** Several contacts are configured — let mom pick whom to call (2 taps total). */
    data object OpenFamilyPicker : HomeEvent
}
