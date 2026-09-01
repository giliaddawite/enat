package com.enat.app.ui.family

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.enat.app.data.family.FamilyContact
import com.enat.app.data.family.FamilyContactRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/**
 * The «ቤተሰብ ደውል» picker, shown only when more than one contact is configured.
 * Picking a person is the second (and last) tap — dialing itself happens in the
 * route layer via ACTION_DIAL.
 */
@HiltViewModel
class FamilyCallViewModel
    @Inject
    constructor(
        familyContactRepository: FamilyContactRepository,
    ) : ViewModel() {
        val contacts: StateFlow<List<FamilyContact>> =
            familyContactRepository.contacts().stateIn(
                viewModelScope,
                SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                emptyList(),
            )

        private companion object {
            const val STOP_TIMEOUT_MILLIS = 5_000L
        }
    }
