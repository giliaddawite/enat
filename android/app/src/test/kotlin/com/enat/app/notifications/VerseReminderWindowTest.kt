package com.enat.app.notifications

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Duration
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * The pure initial-delay math that aims the first periodic run into the
 * 7:00–9:00 morning window — deterministic by construction (a fixed
 * ZonedDateTime in, a Duration out).
 */
class VerseReminderWindowTest {
    private val zone = ZoneId.of("America/New_York")

    private fun at(
        hour: Int,
        minute: Int,
    ): ZonedDateTime = ZonedDateTime.of(2026, 9, 1, hour, minute, 0, 0, zone)

    @Test
    fun `before the window the first run waits for 7am today`() {
        assertEquals(Duration.ofMinutes(90), VerseReminderScheduler.delayUntilReminderWindow(at(5, 30)))
    }

    @Test
    fun `at the window start the delay is zero`() {
        assertEquals(Duration.ZERO, VerseReminderScheduler.delayUntilReminderWindow(at(7, 0)))
    }

    @Test
    fun `inside the window an app start may remind today`() {
        assertEquals(Duration.ZERO, VerseReminderScheduler.delayUntilReminderWindow(at(8, 15)))
    }

    @Test
    fun `at the window end the first run waits for 7am tomorrow`() {
        assertEquals(Duration.ofHours(22), VerseReminderScheduler.delayUntilReminderWindow(at(9, 0)))
    }

    @Test
    fun `after the window the first run waits for 7am tomorrow`() {
        assertEquals(Duration.ofHours(10), VerseReminderScheduler.delayUntilReminderWindow(at(21, 0)))
    }

    @Test
    fun `a fall-back DST night still targets 7am wall time, one extra hour away`() {
        // 2026-11-01 02:00 EDT jumps back to 01:00 EST: that night is 25 hours
        // long, so 21:00 on Oct 31 is 10 wall-clock hours but 11 real hours
        // before 07:00 — the zone-aware math must count the real ones.
        val beforeFallBack = ZonedDateTime.of(2026, 10, 31, 21, 0, 0, 0, zone)
        assertEquals(Duration.ofHours(11), VerseReminderScheduler.delayUntilReminderWindow(beforeFallBack))
    }
}
