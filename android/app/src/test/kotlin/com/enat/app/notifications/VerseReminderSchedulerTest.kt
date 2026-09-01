package com.enat.app.notifications

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Clock
import java.time.ZoneId
import java.time.ZonedDateTime

/**
 * The WorkManager half of the reboot/window criterion, against the work-testing
 * artifact's in-process instance: one unique periodic request, and KEEP semantics
 * so re-scheduling at every app start never resets the persisted schedule. The
 * pure initial-delay math lives in VerseReminderWindowTest; the actual
 * survives-a-reboot behavior is WorkManager's persistence, verified on device.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class VerseReminderSchedulerTest {
    private lateinit var context: Context
    private lateinit var workManager: WorkManager

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
        )
        workManager = WorkManager.getInstance(context)
    }

    private fun scheduler(hour: Int): VerseReminderScheduler =
        VerseReminderScheduler(
            context,
            Clock.fixed(
                ZonedDateTime.of(2026, 9, 1, hour, 0, 0, 0, ZoneId.of("UTC")).toInstant(),
                ZoneId.of("UTC"),
            ),
        )

    @Test
    fun `scheduling enqueues one unique periodic request`() {
        scheduler(hour = 5).scheduleDailyReminder()

        val infos = workManager.getWorkInfosForUniqueWork(VerseReminderScheduler.WORK_NAME).get()
        assertEquals(1, infos.size)
        assertEquals(WorkInfo.State.ENQUEUED, infos.single().state)
    }

    @Test
    fun `a second app start keeps the existing schedule instead of replacing it`() {
        scheduler(hour = 5).scheduleDailyReminder()
        val original = workManager.getWorkInfosForUniqueWork(VerseReminderScheduler.WORK_NAME).get().single()

        // A later launch (different clock, so a different would-be delay) must
        // not reset the persisted schedule — KEEP, not REPLACE.
        scheduler(hour = 23).scheduleDailyReminder()
        val after = workManager.getWorkInfosForUniqueWork(VerseReminderScheduler.WORK_NAME).get()

        assertEquals(1, after.size)
        assertEquals(original.id, after.single().id)
    }
}
