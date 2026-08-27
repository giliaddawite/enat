package com.enat.app

import androidx.lifecycle.ViewModel
import com.enat.app.data.setup.SetupStateRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import javax.inject.Inject

/**
 * Decides the app's entry screen: the one-time setup flow until Gmail consent has
 * completed on this device, the home hub afterwards.
 */
@HiltViewModel
class MainViewModel
    @Inject
    constructor(
        setupStateRepository: SetupStateRepository,
    ) : ViewModel() {
        private val _showSetup = MutableStateFlow(!setupStateRepository.isSetupComplete())
        val showSetup: StateFlow<Boolean> = _showSetup.asStateFlow()

        fun onSetupFinished() {
            _showSetup.value = false
        }
    }
