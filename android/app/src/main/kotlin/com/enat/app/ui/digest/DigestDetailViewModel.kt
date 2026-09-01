package com.enat.app.ui.digest

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.enat.app.data.digest.DigestItem
import com.enat.app.data.digest.DigestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface DigestDetailUiState {
    data object Loading : DigestDetailUiState

    data class Detail(
        val item: DigestItem,
    ) : DigestDetailUiState

    /** The card vanished from the cache (a refresh replaced the digest mid-tap). */
    data object Missing : DigestDetailUiState
}

/** One email's detail view (TICKET-204), read purely from the Room cache — works offline. */
@HiltViewModel
class DigestDetailViewModel
    @Inject
    constructor(
        savedStateHandle: SavedStateHandle,
        private val repository: DigestRepository,
    ) : ViewModel() {
        private val messageId: String =
            requireNotNull(savedStateHandle[MESSAGE_ID_ARG]) {
                "DigestDetail requires a $MESSAGE_ID_ARG argument"
            }

        private val _uiState = MutableStateFlow<DigestDetailUiState>(DigestDetailUiState.Loading)
        val uiState: StateFlow<DigestDetailUiState> = _uiState.asStateFlow()

        init {
            viewModelScope.launch {
                val item = repository.cachedItem(messageId)
                _uiState.value =
                    if (item != null) DigestDetailUiState.Detail(item) else DigestDetailUiState.Missing
            }
        }

        companion object {
            const val MESSAGE_ID_ARG = "messageId"
        }
    }
