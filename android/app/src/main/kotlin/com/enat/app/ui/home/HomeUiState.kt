package com.enat.app.ui.home

import com.enat.app.data.greeting.TimeOfDay

/**
 * The home screen's single source of truth. Every screen in the app follows this
 * shape: a sealed state the ViewModel emits, rendered by a stateless composable.
 */
sealed interface HomeUiState {
    data object Loading : HomeUiState

    data class Greeting(
        val timeOfDay: TimeOfDay,
    ) : HomeUiState

    data object Error : HomeUiState
}
