package com.enat.app.notifications

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.work.Configuration
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import com.enat.app.data.setup.SetupStateRepository
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
 * artifact's in-process instance: nothing before setup consent, one unique
 * periodic request after it, and KEEP semantics so re-scheduling at every app
 * start never resets the persisted schedule. The pure initial-delay math lives
 * in VerseReminderWindowTest; the actual survives-a-reboot behavior is
 * WorkManager's persistence, verified on device.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class VerseReminderSchedulerTest {
    private lateinit var context: Context
    private lateinit var workManager: WorkManager
    private val setupState = FakeSetupStateRepository()

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
        )
        workManager = WorkManager.getInstance(context)
    }

    private fun scheduler(hour: Int): WorkManagerVerseReminderScheduler =
        WorkManagerVerseReminderScheduler(
            context,
            Clock.fixed(
                ZonedDateTime.of(2026, 9, 1, hour, 0, 0, 0, ZoneId.of("UTC")).toInstant(),
                ZoneId.of("UTC"),
            ),
            setupState,
        )

    @Test
    fun `nothing is scheduled before setup completes`() {
        setupState.complete = false

        scheduler(hour = 5).scheduleDailyReminder()

        // An abandoned install (setup never finished, so no consent and — on
        // API 26-32 — no permission gate either) must never get a 7AM reminder.
        assertTrue(workManager.getWorkInfosForUniqueWork(WORK_NAME).get().isEmpty())
    }

    @Test
    fun `after setup completes scheduling enqueues one unique periodic request`() {
        setupState.complete = true

        scheduler(hour = 5).scheduleDailyReminder()

        val infos = workManager.getWorkInfosForUniqueWork(WORK_NAME).get()
        assertEquals(1, infos.size)
        assertEquals(WorkInfo.State.ENQUEUED, infos.single().state)
    }

    @Test
    fun `a second app start keeps the existing schedule instead of replacing it`() {
        setupState.complete = true
        scheduler(hour = 5).scheduleDailyReminder()
        val original = workManager.getWorkInfosForUniqueWork(WORK_NAME).get().single()

        // A later launch (different clock, so a different would-be delay) must
        // not reset the persisted schedule — KEEP, not REPLACE.
        scheduler(hour = 23).scheduleDailyReminder()
        val after = workManager.getWorkInfosForUniqueWork(WORK_NAME).get()

        assertEquals(1, after.size)
        assertEquals(original.id, after.single().id)
    }

    private class FakeSetupStateRepository : SetupStateRepository {
        var complete = false

        override fun isSetupComplete(): Boolean = complete

        override fun markSetupComplete() {
            complete = true
        }

        override fun isNotificationPermissionRequested(): Boolean = false

        override fun markNotificationPermissionRequested() = Unit
    }

    private companion object {
        const val WORK_NAME = WorkManagerVerseReminderScheduler.WORK_NAME
    }
}
