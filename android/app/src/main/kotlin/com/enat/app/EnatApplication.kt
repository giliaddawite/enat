package com.enat.app

import android.app.Application
import com.google.firebase.FirebaseApp
import com.google.firebase.crashlytics.FirebaseCrashlytics
import dagger.hilt.android.HiltAndroidApp

@HiltAndroidApp
class EnatApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        enableCrashReportingForReleaseBuilds()
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
