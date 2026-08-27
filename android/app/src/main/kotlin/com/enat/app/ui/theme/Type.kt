package com.enat.app.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Every style is at least 20sp (Accessibility § CLAUDE.md) — the reader is an
// older adult, and Amharic script needs generous sizing to stay legible.
val EnatTypography =
    Typography(
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
        titleLarge =
            TextStyle(
                fontSize = 26.sp,
                lineHeight = 36.sp,
                fontWeight = FontWeight.Medium,
            ),
        bodyLarge =
            TextStyle(
                fontSize = 22.sp,
                lineHeight = 32.sp,
            ),
        labelLarge =
            TextStyle(
                fontSize = 24.sp,
                lineHeight = 32.sp,
                fontWeight = FontWeight.Medium,
            ),
    )
