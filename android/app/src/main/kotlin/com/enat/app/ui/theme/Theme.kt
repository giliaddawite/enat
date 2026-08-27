package com.enat.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// A fixed high-contrast palette — no dynamic color, so contrast stays WCAG AA
// regardless of the device wallpaper. All pairs below exceed 4.5:1.
private val LightColors =
    lightColorScheme(
        primary = Color(0xFF1B5E20),
        onPrimary = Color(0xFFFFFFFF),
        background = Color(0xFFFFFFFF),
        onBackground = Color(0xFF1A1A1A),
        surface = Color(0xFFFFFFFF),
        onSurface = Color(0xFF1A1A1A),
        error = Color(0xFFB3261E),
        onError = Color(0xFFFFFFFF),
    )

private val DarkColors =
    darkColorScheme(
        primary = Color(0xFFA5D6A7),
        onPrimary = Color(0xFF0D3B10),
        background = Color(0xFF121212),
        onBackground = Color(0xFFECECEC),
        surface = Color(0xFF121212),
        onSurface = Color(0xFFECECEC),
        error = Color(0xFFF2B8B5),
        onError = Color(0xFF601410),
    )

@Composable
fun EnatTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        typography = EnatTypography,
        content = content,
    )
}
