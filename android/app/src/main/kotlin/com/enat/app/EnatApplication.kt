package com.enat.app

import android.app.Application
import com.enat.app.notifications.VerseReminderScheduler
import com.google.firebase.FirebaseApp
import com.google.firebase.crashlytics.FirebaseCrashlytics
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class EnatApplication : Application() {
    @Inject
    lateinit var verseReminderScheduler: VerseReminderScheduler

    override fun onCreate() {
        super.onCreate()
        enableCrashReportingForReleaseBuilds()
        // Every app start re-asserts the daily verse reminder with KEEP — a no-op
        // when the persisted schedule already exists, and a no-op entirely until
        // setup completes (the scheduler gates on it, so an abandoned install
        // never gets a 7AM notification) (TICKET-205).
        verseReminderScheduler.scheduleDailyReminder()
    }

    private fun enableCrashReportingForReleaseBuilds() {
        if (BuildConfig.DEBUG) return
        // initializeApp returns null when the build had no google-services.json
        // (the Firebase project is provisioned with TICKET-003) — in that case the
        // app runs fine, just without crash reporting.
        FirebaseApp.initializeApp(this) ?: return
        FirebaseCrashlytics.getInstance().isCrashlyticsCollectionEnabled = true
    }
}
