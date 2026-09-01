package com.enat.app.ui.common

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import com.enat.app.R

/**
 * ACTION_DIAL — not ACTION_CALL — so no phone permission is needed and mom always
 * sees the dialer with the number filled in before anything rings (TICKET-203).
 */
fun dialPhoneNumber(
    context: Context,
    phoneNumber: String,
) {
    val intent = Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", phoneNumber, null))
    try {
        context.startActivity(intent)
    } catch (noDialer: ActivityNotFoundException) {
        // A device with no dialer (some tablets) — a plain-Amharic notice, not a crash.
        Toast.makeText(context, R.string.dial_error, Toast.LENGTH_LONG).show()
    }
}
