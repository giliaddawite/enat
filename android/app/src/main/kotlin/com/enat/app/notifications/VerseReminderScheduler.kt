package com.enat.app.notifications

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import dagger.hilt.android.qualifiers.ApplicationContext
import java.time.Clock
import java.time.Duration
import java.time.LocalTime
import java.time.ZonedDateTime
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Schedules the daily verse reminder (TICKET-205): a 24h periodic work request,
 * first run delayed into the 7:00–9:00 morning window, enqueued at every app start
 * with KEEP so the one persisted schedule survives untouched. WorkManager persists
 * its work database across process death and reboot — that persistence is the
 * "fires within the target window even after device reboot" criterion.
 *
 * No constraints: the worker is network-free and near-instant, and any constraint
 * could only delay it past the window.
 */
@Singleton
class VerseReminderScheduler
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val clock: Clock,
    ) {
        fun scheduleDailyReminder() {
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
