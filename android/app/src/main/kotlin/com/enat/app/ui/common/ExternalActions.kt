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

/**
 * Opens one message in the Gmail app (TICKET-204's detail deep link). Pinned to the
 * Gmail package: without it the https URL would open a browser sign-in page, which
 * is a dead end on this phone. Gmail missing → a plain-Amharic toast.
 */
fun openMessageInGmail(
    context: Context,
    messageId: String,
) {
    val intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("https://mail.google.com/mail/#all/$messageId"))
            .setPackage(GMAIL_PACKAGE)
    try {
        context.startActivity(intent)
    } catch (gmailMissing: ActivityNotFoundException) {
        Toast.makeText(context, R.string.detail_gmail_missing, Toast.LENGTH_LONG).show()
    }
}

private const val GMAIL_PACKAGE = "com.google.android.gm"
