package com.enat.app.data.greeting

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class ClockGreetingRepositoryTest {
    @Test
    fun `midnight through 11 is morning`() =
        runTest {
            assertEquals(TimeOfDay.MORNING, timeOfDayAt("00:00"))
            assertEquals(TimeOfDay.MORNING, timeOfDayAt("11:59"))
        }

    @Test
    fun `noon through 17 is afternoon`() =
        runTest {
            assertEquals(TimeOfDay.AFTERNOON, timeOfDayAt("12:00"))
            assertEquals(TimeOfDay.AFTERNOON, timeOfDayAt("17:59"))
        }

    @Test
    fun `18 onward is evening`() =
        runTest {
            assertEquals(TimeOfDay.EVENING, timeOfDayAt("18:00"))
            assertEquals(TimeOfDay.EVENING, timeOfDayAt("23:59"))
        }

    private suspend fun timeOfDayAt(time: String): TimeOfDay {
        val clock = Clock.fixed(Instant.parse("2026-08-27T$time:00Z"), ZoneOffset.UTC)
        return ClockGreetingRepository(clock).currentTimeOfDay()
    }
}
