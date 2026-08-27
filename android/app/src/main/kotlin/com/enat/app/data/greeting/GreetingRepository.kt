package com.enat.app.data.greeting

import java.time.Clock
import java.time.LocalTime
import javax.inject.Inject

enum class TimeOfDay { MORNING, AFTERNOON, EVENING }

/**
 * Source of the home screen's greeting. An interface even for this trivial case so
 * tests substitute a fake — the same seam every later repository (digest, verse)
 * will follow.
 */
interface GreetingRepository {
    suspend fun currentTimeOfDay(): TimeOfDay
}

class ClockGreetingRepository
    @Inject
    constructor(
        private val clock: Clock,
    ) : GreetingRepository {
        override suspend fun currentTimeOfDay(): TimeOfDay {
            val hour = LocalTime.now(clock).hour
            return when {
                hour < 12 -> TimeOfDay.MORNING
                hour < 18 -> TimeOfDay.AFTERNOON
                else -> TimeOfDay.EVENING
            }
        }
    }
