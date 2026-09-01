package com.enat.app.notifications

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject

/**
 * Whether the POST_NOTIFICATIONS runtime permission still needs asking — the one
 * platform check the setup flow's notification step depends on, behind an
 * interface so SetupViewModel stays testable with a fake.
 */
interface NotificationPermissionGateway {
    fun needsRequest(): Boolean
}

class AndroidNotificationPermissionGateway
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
    ) : NotificationPermissionGateway {
        override fun needsRequest(): Boolean {
            // Before Android 13 notifications need no runtime permission.
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                PackageManager.PERMISSION_GRANTED
        }
    }
