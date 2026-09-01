package com.enat.app.data.verse

/**
 * The daily verse as the app renders it — `GET /v1/verse/today`
 * (`backend/src/domain/verse.ts`). Amharic primary, English secondary.
 */
data class Verse(
    /** The backend's UTC date key for this verse, e.g. `2026-09-01`. */
    val date: String,
    /** English reference, e.g. `"Psalm 23:1"`. */
    val reference: String,
    /** Amharic reference, e.g. `"መዝሙር 23፥1"`. */
    val referenceAm: String,
    val textEn: String,
    val textAm: String,
)
