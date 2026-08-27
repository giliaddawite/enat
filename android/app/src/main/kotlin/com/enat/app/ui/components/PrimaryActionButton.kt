package com.enat.app.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

// No contentDescription override: TalkBack reads the visible label itself, and a
// duplicate description would drown it out (the redundant-description
// anti-pattern). Text buttons only ever need their label.
// Pass [colors] only as an audited role pair from Theme.kt (the default is
// primary/onPrimary); hosts on tinted surfaces override it, e.g. ReconnectCard.
@Composable
fun PrimaryActionButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    colors: ButtonColors = ButtonDefaults.buttonColors(),
) {
    Button(
        onClick = onClick,
        colors = colors,
        modifier =
            modifier
                .fillMaxWidth()
                // 64dp minimum touch target — deliberately above the 48dp guideline.
                .heightIn(min = 64.dp),
    ) {
        Text(text = label, style = MaterialTheme.typography.labelLarge)
    }
}
