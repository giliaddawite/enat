package com.enat.app.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.enat.app.data.family.FamilyContact
import com.enat.app.data.family.FamilyContactRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FamilySettingsUiState(
    val contacts: List<FamilyContact> = emptyList(),
    val nameInput: String = "",
    val phoneInput: String = "",
    val showValidationError: Boolean = false,
)

/**
 * The caregiver's quick-dial editor behind the hub's hidden long-press entry
 * (TICKET-203). Local Room storage only — contacts never sync anywhere.
 */
@HiltViewModel
class FamilySettingsViewModel
    @Inject
    constructor(
        private val familyContactRepository: FamilyContactRepository,
    ) : ViewModel() {
        private data class FormState(
            val name: String = "",
            val phone: String = "",
            val showValidationError: Boolean = false,
        )

        private val form = MutableStateFlow(FormState())

        val uiState: StateFlow<FamilySettingsUiState> =
            combine(familyContactRepository.contacts(), form) { contacts, formState ->
                FamilySettingsUiState(
                    contacts = contacts,
                    nameInput = formState.name,
                    phoneInput = formState.phone,
                    showValidationError = formState.showValidationError,
                )
            }.stateIn(
                viewModelScope,
                SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                FamilySettingsUiState(),
            )

        fun onNameChanged(name: String) {
            form.value = form.value.copy(name = name, showValidationError = false)
        }

        fun onPhoneChanged(phone: String) {
            form.value = form.value.copy(phone = phone, showValidationError = false)
        }

        fun addContact() {
            val name = form.value.name.trim()
            val phone = form.value.phone.trim()
            if (name.isEmpty() || !isDialable(phone)) {
                form.value = form.value.copy(showValidationError = true)
                return
            }
            viewModelScope.launch {
                familyContactRepository.add(name, phone)
                form.value = FormState()
            }
        }

        fun removeContact(id: Long) {
            viewModelScope.launch { familyContactRepository.remove(id) }
        }

        /** Just enough validation for ACTION_DIAL: at least one digit, dialer characters only. */
        private fun isDialable(phone: String): Boolean =
            phone.any(Char::isDigit) && phone.all { it.isDigit() || it in "+ -()" }

        private companion object {
            const val STOP_TIMEOUT_MILLIS = 5_000L
        }
    }
