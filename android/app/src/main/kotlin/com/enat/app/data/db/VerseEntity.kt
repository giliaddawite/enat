package com.enat.app.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * The cached daily verse (TICKET-205's offline-first cache). A single-row table
 * (`id` fixed at [SINGLETON_ID]) exactly like the digest header: the app caches
 * the last verse it saw and renders it with no network.
 */
@Entity(tableName = "cached_verse")
data class VerseEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    /** The UTC date key the backend stamped this verse with, e.g. `2026-09-01`. */
    val date: String,
    val reference: String,
    val referenceAm: String,
    val textEn: String,
    val textAm: String,
    /** The server's ETag for this content, replayed as If-None-Match on revalidation. */
    val etag: String?,
) {
    companion object {
        const val SINGLETON_ID = 0
    }
}
