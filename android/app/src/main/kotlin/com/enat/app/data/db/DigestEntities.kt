package com.enat.app.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * The cached digest's header row (TICKET-204's offline-first cache). A single-row
 * table (`id` fixed at [SINGLETON_ID]): the app caches exactly the last digest.
 * Only summaries ever reach the device — email bodies never leave the backend.
 */
@Entity(tableName = "cached_digest")
data class DigestEntity(
    @PrimaryKey val id: Int = SINGLETON_ID,
    val date: String,
    val generatedAt: String,
    val emailCount: Int,
    /** The server's ETag for this content, replayed as If-None-Match on revalidation. */
    val etag: String?,
) {
    companion object {
        const val SINGLETON_ID = 0
    }
}

/** One email's cached card, ordered exactly as the server sent it. */
@Entity(tableName = "digest_items")
data class DigestItemEntity(
    @PrimaryKey val messageId: String,
    /** The category's wire id (`important`, `bills_accounts`, …). */
    val category: String,
    val sectionOrder: Int,
    val itemOrder: Int,
    val sender: String,
    val subject: String,
    val summary: String?,
    val urgent: Boolean,
    val receivedAt: String,
)
