package com.enat.app.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query
import androidx.room.Transaction

@Dao
interface DigestDao {
    @Query("SELECT * FROM cached_digest WHERE id = ${DigestEntity.SINGLETON_ID}")
    suspend fun digest(): DigestEntity?

    @Query("SELECT * FROM digest_items ORDER BY sectionOrder, itemOrder")
    suspend fun items(): List<DigestItemEntity>

    @Query("SELECT * FROM digest_items WHERE messageId = :messageId")
    suspend fun item(messageId: String): DigestItemEntity?

    /** Atomically swaps the cached digest — readers never see a header without its items. */
    @Transaction
    suspend fun replace(
        digest: DigestEntity,
        items: List<DigestItemEntity>,
    ) {
        clearDigest()
        clearItems()
        insertDigest(digest)
        insertItems(items)
    }

    @Insert
    suspend fun insertDigest(digest: DigestEntity)

    @Insert
    suspend fun insertItems(items: List<DigestItemEntity>)

    @Query("DELETE FROM cached_digest")
    suspend fun clearDigest()

    @Query("DELETE FROM digest_items")
    suspend fun clearItems()
}
