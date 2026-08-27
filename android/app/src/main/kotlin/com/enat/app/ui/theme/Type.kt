package com.enat.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Every Material3 type role is overridden here — all 15 of them — so nothing can
// fall back to the 11–16sp Material defaults. The floor is 20sp (Accessibility §
// CLAUDE.md): the reader is an older adult, and Amharic script needs generous
// sizing to stay legible.
val EnatTypography =
    Typography(
        displayLarge =
            TextStyle(
                fontSize = 48.sp,
                lineHeight = 60.sp,
                fontWeight = FontWeight.Bold,
            ),
        displayMedium =
            TextStyle(
                fontSize = 44.sp,
                lineHeight = 56.sp,
                fontWeight = FontWeight.Bold,
            ),
        displaySmall =
            TextStyle(
                fontSize = 40.sp,
                lineHeight = 52.sp,
                fontWeight = FontWeight.Bold,
            ),
        headlineLarge =
            TextStyle(
                fontSize = 34.sp,
                lineHeight = 46.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        headlineMedium =
            TextStyle(
                fontSize = 30.sp,
                lineHeight = 40.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        headlineSmall =
            TextStyle(
                fontSize = 28.sp,
                lineHeight = 38.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        titleLarge =
            TextStyle(
                fontSize = 26.sp,
                lineHeight = 36.sp,
                fontWeight = FontWeight.Medium,
            ),
        titleMedium =
            TextStyle(
                fontSize = 24.sp,
                lineHeight = 34.sp,
                fontWeight = FontWeight.Medium,
            ),
        titleSmall =
            TextStyle(
                fontSize = 22.sp,
                lineHeight = 30.sp,
                fontWeight = FontWeight.Medium,
            ),
        bodyLarge =
            TextStyle(
                fontSize = 22.sp,
                lineHeight = 32.sp,
            ),
        bodyMedium =
            TextStyle(
                fontSize = 21.sp,
                lineHeight = 30.sp,
            ),
        bodySmall =
            TextStyle(
                fontSize = 20.sp,
                lineHeight = 28.sp,
            ),
        labelLarge =
            TextStyle(
                fontSize = 24.sp,
                lineHeight = 32.sp,
                fontWeight = FontWeight.Medium,
            ),
        labelMedium =
            TextStyle(
                fontSize = 22.sp,
                lineHeight = 30.sp,
                fontWeight = FontWeight.Medium,
            ),
        labelSmall =
            TextStyle(
                fontSize = 20.sp,
                lineHeight = 28.sp,
                fontWeight = FontWeight.Medium,
            ),
    )
