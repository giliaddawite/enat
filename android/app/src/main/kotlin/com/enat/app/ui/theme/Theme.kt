package com.enat.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// A fixed palette — no dynamic color, so contrast never depends on the device
// wallpaper. Audited roles (WCAG AA, ≥4.5:1 for each on-color over its color;
// outline ≥3:1 over background): primary/onPrimary, primaryContainer/
// onPrimaryContainer, secondary/onSecondary, secondaryContainer/
// onSecondaryContainer, tertiary/onTertiary, tertiaryContainer/
// onTertiaryContainer, background/onBackground, surface/onSurface,
// surfaceVariant/onSurfaceVariant, error/onError, errorContainer/
// onErrorContainer, outline. Cross-role pairings audited beyond the on-color
// pairs: primary text over surfaceVariant (6.52:1 light, 8.39:1 dark — the
// verse card's reference lines). Roles and pairings not listed are NOT
// audited — audit before first use and add them here explicitly.
private val LightColors =
    lightColorScheme(
        primary = Color(0xFF1B5E20),
        onPrimary = Color(0xFFFFFFFF),
        primaryContainer = Color(0xFFC8E6C9),
        onPrimaryContainer = Color(0xFF0D3B10),
        secondary = Color(0xFF4E342E),
        onSecondary = Color(0xFFFFFFFF),
        secondaryContainer = Color(0xFFEFE0DA),
        onSecondaryContainer = Color(0xFF3E2723),
        tertiary = Color(0xFF01579B),
        onTertiary = Color(0xFFFFFFFF),
        tertiaryContainer = Color(0xFFD6E9FB),
        onTertiaryContainer = Color(0xFF013354),
        background = Color(0xFFFFFFFF),
        onBackground = Color(0xFF1A1A1A),
        surface = Color(0xFFFFFFFF),
        onSurface = Color(0xFF1A1A1A),
        surfaceVariant = Color(0xFFE7EBE4),
        onSurfaceVariant = Color(0xFF3F463E),
        outline = Color(0xFF5C6B5C),
        error = Color(0xFFB3261E),
        onError = Color(0xFFFFFFFF),
        errorContainer = Color(0xFFF9DEDC),
        onErrorContainer = Color(0xFF410E0B),
    )

private val DarkColors =
    darkColorScheme(
        primary = Color(0xFFA5D6A7),
        onPrimary = Color(0xFF0D3B10),
        primaryContainer = Color(0xFF1B5E20),
        onPrimaryContainer = Color(0xFFC8E6C9),
        secondary = Color(0xFFD7CCC8),
        onSecondary = Color(0xFF2E211E),
        secondaryContainer = Color(0xFF4E342E),
        onSecondaryContainer = Color(0xFFEFE0DA),
        tertiary = Color(0xFF90CAF9),
        onTertiary = Color(0xFF013354),
        tertiaryContainer = Color(0xFF01579B),
        onTertiaryContainer = Color(0xFFD6E9FB),
        background = Color(0xFF121212),
        onBackground = Color(0xFFECECEC),
        surface = Color(0xFF121212),
        onSurface = Color(0xFFECECEC),
        surfaceVariant = Color(0xFF2A2E2A),
        onSurfaceVariant = Color(0xFFC7CFC7),
        outline = Color(0xFF9AA69A),
        error = Color(0xFFF2B8B5),
        onError = Color(0xFF601410),
        errorContainer = Color(0xFF8C1D18),
        onErrorContainer = Color(0xFFF9DEDC),
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
