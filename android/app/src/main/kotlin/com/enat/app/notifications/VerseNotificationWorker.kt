package com.enat.app.notifications

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.enat.app.MainActivity
import com.enat.app.R

/**
 * Posts the gentle morning reminder that the day's verse is ready (TICKET-205).
 *
 * Deliberately network-free: the notification carries only static resource text,
 * never the verse itself — so nothing private-ish sits on the lock screen, the
 * worker needs no constraints that could push it out of the morning window, and
 * the reboot/window acceptance criterion is purely about WorkManager scheduling.
 *
 * Do Not Disturb: the channel uses IMPORTANCE_DEFAULT — not high importance, no
 * alarm category, no sound override, no full-screen intent. That mapping is what
 * makes Android suppress this notification while DND is on (only channels the
 * user has explicitly exempted, or calls/alarms, break through). A missed
 * reminder is the correct outcome of a do-not-disturb morning.
 */
class VerseNotificationWorker(
    context: Context,
    parameters: WorkerParameters,
) : Worker(context, parameters) {
    override fun doWork(): Result {
        val context = applicationContext
        if (!notificationsAllowed(context)) {
            // Permission was declined during setup (or later, in system settings).
            // Everything else works; the reminder simply stays silent — no retry,
            // no nagging.
            return Result.success()
        }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(reminderChannel(context))
        manager.notify(NOTIFICATION_ID, reminderNotification(context))
        return Result.success()
    }

    private fun notificationsAllowed(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun reminderChannel(context: Context): NotificationChannel =
        NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_name),
            // IMPORTANCE_DEFAULT is the DND contract — see the class comment.
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.notification_channel_description)
        }

    private fun reminderNotification(context: Context): android.app.Notification {
        val openVerse =
            Intent(context, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_OPEN_VERSE, true)
                // Restart the task at the verse screen: predictable for the reader
                // (back always lands on the hub) and it keeps the deep link to a
                // single onCreate-read extra — no onNewIntent plumbing.
                .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        val tapAction =
            PendingIntent.getActivity(
                context,
                0,
                openVerse,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(context.getString(R.string.notification_verse_title))
            .setContentText(context.getString(R.string.notification_verse_body))
            .setContentIntent(tapAction)
            .setAutoCancel(true)
            // PRIORITY_DEFAULT mirrors the channel importance for pre-O code paths.
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()
    }

    companion object {
        const val CHANNEL_ID = "daily_verse_reminder"
        const val NOTIFICATION_ID = 205
    }
}
