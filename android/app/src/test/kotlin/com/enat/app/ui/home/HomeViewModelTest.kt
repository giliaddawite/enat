package com.enat.app.ui.home

import app.cash.turbine.test
import com.enat.app.MainDispatcherRule
import com.enat.app.data.family.FamilyContact
import com.enat.app.data.family.FamilyContactRepository
import com.enat.app.data.greeting.GreetingRepository
import com.enat.app.data.greeting.TimeOfDay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.util.Locale

class HomeViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    // 2026-08-25 10:15 in Addis Ababa — a fixed clock keeps every assertion stable.
    private val fixedClock =
        Clock.fixed(Instant.parse("2026-08-25T07:15:00Z"), ZoneId.of("Africa/Addis_Ababa"))
    private val contactsFlow = MutableStateFlow<List<FamilyContact>>(emptyList())

    @Before
    fun pinLocale() {
        // Locale-sensitive date formatting must be deterministic under test.
        Locale.setDefault(Locale.US)
    }

    private fun viewModel(): HomeViewModel =
        HomeViewModel(
            greetingRepository = FakeGreetingRepository(TimeOfDay.MORNING),
            familyContactRepository = FakeFamilyContactRepository(contactsFlow),
            clock = fixedClock,
        )

    @Test
    fun `emits the hub with locale-formatted date and time`() =
        runTest {
            viewModel().uiState.test {
                assertEquals(HomeUiState.Loading, awaitItem())
                val hub = awaitItem() as HomeUiState.Hub
                assertEquals(TimeOfDay.MORNING, hub.timeOfDay)
                // FormatStyle.FULL/SHORT for en-US at the fixed instant — proves the
                // device locale formats the date, not a hand-rolled calendar. (Loose
                // matches: CLDR whitespace details vary across JDK versions.)
                assertEquals("Tuesday, August 25, 2026", hub.dateText)
                assertTrue(hub.timeText.startsWith("10:15"))
                assertFalse(hub.showCallNotConfigured)
            }
        }

    @Test
    fun `call family with no contacts shows the not-configured notice`() =
        runTest {
            val viewModel = viewModel()
            viewModel.uiState.test {
                awaitItem() // Loading
                awaitItem() // Hub
                viewModel.onCallFamily()
                val hub = awaitItem() as HomeUiState.Hub
                assertTrue(hub.showCallNotConfigured)
            }
        }

    @Test
    fun `call family with one contact dials it directly`() =
        runTest {
            contactsFlow.value = listOf(FamilyContact(id = 1, name = "ሙሉ", phoneNumber = "+15551234567"))
            val viewModel = viewModel()
            viewModel.events.test {
                viewModel.onCallFamily()
                assertEquals(HomeEvent.DialFamily("+15551234567"), awaitItem())
            }
        }

    @Test
    fun `call family with several contacts opens the picker`() =
        runTest {
            contactsFlow.value =
                listOf(
                    FamilyContact(id = 1, name = "ሙሉ", phoneNumber = "+15551234567"),
                    FamilyContact(id = 2, name = "ሳራ", phoneNumber = "+15559876543"),
                )
            val viewModel = viewModel()
            viewModel.events.test {
                viewModel.onCallFamily()
                assertEquals(HomeEvent.OpenFamilyPicker, awaitItem())
            }
        }

    private class FakeGreetingRepository(
        private val timeOfDay: TimeOfDay,
    ) : GreetingRepository {
        override suspend fun currentTimeOfDay(): TimeOfDay = timeOfDay
    }

    private class FakeFamilyContactRepository(
        private val flow: Flow<List<FamilyContact>>,
    ) : FamilyContactRepository {
        override fun contacts(): Flow<List<FamilyContact>> = flow

        override suspend fun add(
            name: String,
            phoneNumber: String,
        ) = error("not used")

        override suspend fun remove(id: Long) = error("not used")
    }
}
