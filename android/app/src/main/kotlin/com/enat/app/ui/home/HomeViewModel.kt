package com.enat.app.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.enat.app.data.family.FamilyContactRepository
import com.enat.app.data.greeting.GreetingRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Clock
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import javax.inject.Inject

@HiltViewModel
class HomeViewModel
    @Inject
    constructor(
        private val greetingRepository: GreetingRepository,
        private val familyContactRepository: FamilyContactRepository,
        private val clock: Clock,
    ) : ViewModel() {
        private val showCallNotConfigured = MutableStateFlow(false)

        val uiState: StateFlow<HomeUiState> =
            combine(minuteTicks(), showCallNotConfigured) { now, notConfigured ->
                HomeUiState.Hub(
                    timeOfDay = greetingRepository.currentTimeOfDay(),
                    // Device-locale formatting: with the phone set to Amharic these
                    // localize automatically — no hand-rolled calendar (TICKET-203).
                    dateText = now.format(dateFormatter()),
                    timeText = now.format(timeFormatter()),
                    showCallNotConfigured = notConfigured,
                )
            }.stateIn(
                viewModelScope,
                SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                HomeUiState.Loading,
            )

        private val _events = Channel<HomeEvent>(Channel.BUFFERED)
        val events: Flow<HomeEvent> = _events.receiveAsFlow()

        /**
         * «ቤተሰብ ደውል»: one configured contact dials directly; several open a picker;
         * none shows a plain-Amharic notice instead of failing silently.
         */
        fun onCallFamily() {
            viewModelScope.launch {
                val contacts = familyContactRepository.contacts().first()
                when {
                    contacts.isEmpty() -> showCallNotConfigured.value = true
                    contacts.size == 1 -> _events.send(HomeEvent.DialFamily(contacts.single().phoneNumber))
                    else -> _events.send(HomeEvent.OpenFamilyPicker)
                }
            }
        }

        /** Emits the current time once, then again at every minute boundary. */
        private fun minuteTicks(): Flow<ZonedDateTime> =
            flow {
                while (true) {
                    emit(ZonedDateTime.now(clock))
                    delay(MINUTE_MILLIS - clock.millis() % MINUTE_MILLIS)
                }
            }

        private fun dateFormatter(): DateTimeFormatter =
            DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(Locale.getDefault())

        private fun timeFormatter(): DateTimeFormatter =
            DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(Locale.getDefault())

        private companion object {
            const val MINUTE_MILLIS = 60_000L
            const val STOP_TIMEOUT_MILLIS = 5_000L
        }
    }
