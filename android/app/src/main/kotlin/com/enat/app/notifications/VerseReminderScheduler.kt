package com.enat.app.notifications

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.enat.app.data.setup.SetupStateRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Clock
import java.time.Duration
import java.time.LocalTime
import java.time.ZonedDateTime
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Schedules the daily verse reminder (TICKET-205) — behind an interface so
 * SetupViewModel stays testable with a fake.
 */
interface VerseReminderScheduler {
    fun scheduleDailyReminder()
}

/**
 * The WorkManager implementation: a 24h periodic work request, first run delayed
 * into the 7:00–9:00 morning window, enqueued at every app start with KEEP so the
 * one persisted schedule survives untouched. WorkManager persists its work
 * database across process death and reboot — that persistence is the "fires
 * within the target window even after device reboot" criterion.
 *
 * Nothing is scheduled until setup has completed: reminders are part of the
 * consented experience, and on API 26–32 there is no POST_NOTIFICATIONS gate, so
 * an abandoned install must never wake anyone at 7AM. The setup flow calls
 * [scheduleDailyReminder] right after marking completion, so the first schedule
 * anchors immediately; app starts re-assert it from then on.
 *
 * No constraints: the worker is network-free and near-instant, and any constraint
 * could only delay it past the window.
 */
@Singleton
class WorkManagerVerseReminderScheduler
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val clock: Clock,
        private val setupStateRepository: SetupStateRepository,
    ) : VerseReminderScheduler {
        override fun scheduleDailyReminder() {
            if (!setupStateRepository.isSetupComplete()) return
            val request =
                PeriodicWorkRequestBuilder<VerseNotificationWorker>(Duration.ofDays(1))
                    .setInitialDelay(delayUntilReminderWindow(ZonedDateTime.now(clock)))
                    .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                // KEEP: re-enqueueing on every launch never resets the schedule a
                // previous launch (or pre-reboot boot) already anchored to 7:00.
                ExistingPeriodicWorkPolicy.KEEP,
                request,
            )
        }

        companion object {
            const val WORK_NAME = "daily-verse-reminder"
            val WINDOW_START: LocalTime = LocalTime.of(7, 0)
            val WINDOW_END: LocalTime = LocalTime.of(9, 0)

            /**
             * How long to wait so the first run lands inside the morning window:
             * zero when already inside it (an in-window app start may remind
             * today), otherwise until the next 7:00 — today's if it is still
             * ahead, tomorrow's if not. Zone arithmetic via [ZonedDateTime], so a
             * DST jump shifts the target instant with the wall clock.
             */
            fun delayUntilReminderWindow(now: ZonedDateTime): Duration {
                val time = now.toLocalTime()
                return when {
                    time < WINDOW_START -> Duration.between(now, now.with(WINDOW_START))
                    time < WINDOW_END -> Duration.ZERO
                    else -> Duration.between(now, now.plusDays(1).with(WINDOW_START))
                }
            }
        }
    }
