package com.enat.app.data.setup

import android.content.Context
import androidx.core.content.edit
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject

/**
 * Whether the one-time Google/Gmail setup has completed on this device, plus
 * whether the notification-permission dialog was ever shown (TICKET-205). Two
 * booleans, so SharedPreferences carries them — no DataStore dependency until
 * something heavier needs one. No tokens are ever stored here (or anywhere else
 * on device).
 */
interface SetupStateRepository {
    fun isSetupComplete(): Boolean

    fun markSetupComplete()

    /**
     * True once the POST_NOTIFICATIONS dialog has been answered. Persisted so a
     * restarted setup (reconnect, dead session) never re-asks after a denial —
     * "asked at most once" is a promise, not a per-process accident.
     */
    fun isNotificationPermissionRequested(): Boolean

    fun markNotificationPermissionRequested()
}

class PreferencesSetupStateRepository
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) : SetupStateRepository {
        private val preferences by lazy {
            context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
        }

        override fun isSetupComplete(): Boolean = preferences.getBoolean(KEY_SETUP_COMPLETE, false)

        override fun markSetupComplete() {
            preferences.edit { putBoolean(KEY_SETUP_COMPLETE, true) }
        }

        override fun isNotificationPermissionRequested(): Boolean =
            preferences.getBoolean(KEY_NOTIFICATION_PERMISSION_REQUESTED, false)

        override fun markNotificationPermissionRequested() {
            preferences.edit { putBoolean(KEY_NOTIFICATION_PERMISSION_REQUESTED, true) }
        }

        private companion object {
            const val PREFERENCES_NAME = "enat_setup"
            const val KEY_SETUP_COMPLETE = "setup_complete"
            const val KEY_NOTIFICATION_PERMISSION_REQUESTED = "notification_permission_requested"
        }
    }
