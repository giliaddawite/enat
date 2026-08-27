package com.enat.app.ui.home

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.enat.app.data.greeting.GreetingRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class HomeViewModel
    @Inject
    constructor(
        private val greetingRepository: GreetingRepository,
    ) : ViewModel() {
        private val _uiState = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
        val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

        init {
            refresh()
        }

        fun refresh() {
            _uiState.value = HomeUiState.Loading
            viewModelScope.launch {
                _uiState.value =
                    try {
                        HomeUiState.Greeting(greetingRepository.currentTimeOfDay())
                    } catch (cancellation: CancellationException) {
                        throw cancellation
                    } catch (failure: Exception) {
                        // Surfaced to the user as a retryable error state, never swallowed.
                        Log.e(TAG, "Failed to load greeting", failure)
                        HomeUiState.Error
                    }
            }
        }

        private companion object {
            const val TAG = "HomeViewModel"
        }
    }
