package com.enat.app.ui.settings

import app.cash.turbine.test
import com.enat.app.MainDispatcherRule
import com.enat.app.data.family.FamilyContact
import com.enat.app.data.family.FamilyContactRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class FamilySettingsViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val repository = FakeFamilyContactRepository()

    @Test
    fun `shows configured contacts`() =
        runTest {
            repository.state.value = listOf(FamilyContact(id = 1, name = "ሙሉ", phoneNumber = "+15551234567"))
            val viewModel = FamilySettingsViewModel(repository)

            viewModel.uiState.test {
                awaitItem() // initial empty state
                assertEquals(listOf("ሙሉ"), awaitItem().contacts.map { it.name })
            }
        }

    @Test
    fun `valid contact is added and the form clears`() =
        runTest {
            val viewModel = FamilySettingsViewModel(repository)
            viewModel.uiState.test {
                awaitItem()

                viewModel.onNameChanged("ሳራ")
                awaitItem()
                viewModel.onPhoneChanged("+1 555 987-6543")
                awaitItem()
                viewModel.addContact()

                val added = awaitItem()
                assertEquals("", added.nameInput)
                assertEquals("", added.phoneInput)
                // Success is confirmed explicitly — a cleared form alone is ambiguous.
                assertEquals(ContactChange.ADDED, added.confirmation)
                assertEquals(listOf("ሳራ" to "+1 555 987-6543"), repository.added)
            }
        }

    @Test
    fun `blank name is rejected with a validation error and nothing is stored`() =
        runTest {
            val viewModel = FamilySettingsViewModel(repository)
            viewModel.uiState.test {
                awaitItem()

                viewModel.onPhoneChanged("+15551234567")
                awaitItem()
                viewModel.addContact()

                assertTrue(awaitItem().showValidationError)
                assertTrue(repository.added.isEmpty())
            }
        }

    @Test
    fun `non-dialable phone is rejected with a validation error`() =
        runTest {
            val viewModel = FamilySettingsViewModel(repository)
            viewModel.uiState.test {
                awaitItem()

                viewModel.onNameChanged("ሙሉ")
                awaitItem()
                viewModel.onPhoneChanged("not a number")
                awaitItem()
                viewModel.addContact()

                assertTrue(awaitItem().showValidationError)
                assertTrue(repository.added.isEmpty())
            }
        }

    @Test
    fun `editing an input clears the validation error`() =
        runTest {
            val viewModel = FamilySettingsViewModel(repository)
            viewModel.uiState.test {
                awaitItem()

                viewModel.addContact()
                assertTrue(awaitItem().showValidationError)

                viewModel.onNameChanged("ሙ")
                assertFalse(awaitItem().showValidationError)
            }
        }

    @Test
    fun `remove delegates to the repository and confirms it`() =
        runTest {
            val viewModel = FamilySettingsViewModel(repository)
            viewModel.uiState.test {
                awaitItem()

                viewModel.removeContact(7)
                advanceUntilIdle()

                assertEquals(ContactChange.REMOVED, awaitItem().confirmation)
            }
            assertEquals(listOf(7L), repository.removed)
        }

    @Test
    fun `typing again clears the confirmation`() =
        runTest {
            val viewModel = FamilySettingsViewModel(repository)
            viewModel.uiState.test {
                awaitItem()

                viewModel.removeContact(7)
                advanceUntilIdle()
                awaitItem() // confirmation shown

                viewModel.onNameChanged("ሙ")
                assertEquals(null, awaitItem().confirmation)
            }
        }

    private class FakeFamilyContactRepository : FamilyContactRepository {
        val state = MutableStateFlow<List<FamilyContact>>(emptyList())
        val added = mutableListOf<Pair<String, String>>()
        val removed = mutableListOf<Long>()

        override fun contacts(): Flow<List<FamilyContact>> = state

        override suspend fun add(
            name: String,
            phoneNumber: String,
        ) {
            added += name to phoneNumber
        }

        override suspend fun remove(id: Long) {
            removed += id
        }
    }
}
