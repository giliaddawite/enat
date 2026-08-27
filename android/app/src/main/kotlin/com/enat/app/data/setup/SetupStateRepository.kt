package com.enat.app.data.setup

import android.content.Context
import androidx.core.content.edit
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject

/**
 * Whether the one-time Google/Gmail setup has completed on this device. A single
 * boolean, so SharedPreferences carries it — no DataStore dependency until something
 * heavier needs one. No tokens are ever stored here (or anywhere else on device).
 */
interface SetupStateRepository {
    fun isSetupComplete(): Boolean

    fun markSetupComplete()
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

        private companion object {
            const val PREFERENCES_NAME = "enat_setup"
            const val KEY_SETUP_COMPLETE = "setup_complete"
        }
    }
