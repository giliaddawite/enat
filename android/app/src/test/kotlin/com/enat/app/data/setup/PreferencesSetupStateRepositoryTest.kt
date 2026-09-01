package com.enat.app.data.setup

import android.app.Application
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class PreferencesSetupStateRepositoryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun `setup is incomplete on a clean install`() {
        assertFalse(PreferencesSetupStateRepository(context).isSetupComplete())
    }

    @Test
    fun `marking complete persists across repository instances`() {
        PreferencesSetupStateRepository(context).markSetupComplete()

        assertTrue(PreferencesSetupStateRepository(context).isSetupComplete())
    }

    @Test
    fun `the notification permission has not been requested on a clean install`() {
        assertFalse(PreferencesSetupStateRepository(context).isNotificationPermissionRequested())
    }

    @Test
    fun `marking the permission requested persists across repository instances`() {
        PreferencesSetupStateRepository(context).markNotificationPermissionRequested()

        assertTrue(PreferencesSetupStateRepository(context).isNotificationPermissionRequested())
    }
}
