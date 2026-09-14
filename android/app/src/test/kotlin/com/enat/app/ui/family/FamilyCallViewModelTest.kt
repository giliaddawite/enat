package com.enat.app.ui.family

import app.cash.turbine.test
import com.enat.app.MainDispatcherRule
import com.enat.app.data.family.FamilyContact
import com.enat.app.data.family.FamilyContactRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class FamilyCallViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val repository = FakeFamilyContactRepository()

    private val contacts =
        listOf(
            FamilyContact(id = 1, name = "ሙሉ", phoneNumber = "+15555550101"),
            FamilyContact(id = 2, name = "ሳራ", phoneNumber = "+15555550102"),
        )

    @Test
    fun `starts empty until the cache answers, then lists every configured contact`() =
        runTest {
            repository.state.value = contacts
            val viewModel = FamilyCallViewModel(repository)

            viewModel.contacts.test {
                // The stateIn placeholder — a blank list — is the loading frame.
                assertTrue(awaitItem().isEmpty())
                assertEquals(contacts, awaitItem())
            }
        }

    @Test
    fun `stays empty when no contact is configured`() =
        runTest {
            val viewModel = FamilyCallViewModel(repository)

            viewModel.contacts.test {
                assertTrue(awaitItem().isEmpty())
                expectNoEvents()
            }
        }

    @Test
    fun `reflects a contact removed while the picker is open`() =
        runTest {
            repository.state.value = contacts
            val viewModel = FamilyCallViewModel(repository)

            viewModel.contacts.test {
                awaitItem() // placeholder
                awaitItem() // both contacts
                repository.state.value = contacts.take(1)
                assertEquals(listOf("ሙሉ"), awaitItem().map { it.name })
            }
        }

    private class FakeFamilyContactRepository : FamilyContactRepository {
        val state = MutableStateFlow<List<FamilyContact>>(emptyList())

        override fun contacts(): Flow<List<FamilyContact>> = state

        override suspend fun add(
            name: String,
            phoneNumber: String,
        ) = error("not used")

        override suspend fun remove(id: Long) = error("not used")
    }
}
