package com.enat.app.notifications

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import com.enat.app.MainActivity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class VerseNotificationWorkerTest {
    private val application: Application = ApplicationProvider.getApplicationContext()
    private val notificationManager: NotificationManager =
        application.getSystemService(NotificationManager::class.java)

    private fun runWorker(): ListenableWorker.Result =
        TestListenableWorkerBuilder<VerseNotificationWorker>(application).build().doWork()

    @Test
    fun `posts the static reminder when notifications are allowed`() {
        shadowOf(application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)

        val result = runWorker()

        assertEquals(ListenableWorker.Result.success(), result)
        val posted = shadowOf(notificationManager).allNotifications
        assertEquals(1, posted.size)
    }

    @Test
    fun `the channel is normal importance so Do Not Disturb suppresses it`() {
        shadowOf(application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)

        runWorker()

        // IMPORTANCE_DEFAULT (not high/alarm, no sound override, no full-screen
        // intent) is exactly what lets Android silence this channel under DND —
        // the ticket's DND acceptance criterion, pinned here.
        val channel = notificationManager.getNotificationChannel(VerseNotificationWorker.CHANNEL_ID)
        assertEquals(NotificationManager.IMPORTANCE_DEFAULT, channel.importance)
    }

    @Test
    fun `tapping the reminder opens the app at the verse screen`() {
        shadowOf(application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)

        runWorker()

        val notification = shadowOf(notificationManager).allNotifications.single()
        val launched = shadowOf(notification.contentIntent).savedIntent
        assertEquals(MainActivity::class.java.name, launched.component?.className)
        assertTrue(launched.getBooleanExtra(MainActivity.EXTRA_OPEN_VERSE, false))
    }

    @Test
    fun `a denied permission means silence, not failure`() {
        shadowOf(application).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)

        val result = runWorker()

        // Graceful degradation: no notification, no retry, no error — the rest
        // of the app is untouched by the denial.
        assertEquals(ListenableWorker.Result.success(), result)
        assertEquals(0, shadowOf(notificationManager).allNotifications.size)
    }
}
