package com.enat.app.data.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface VerseDao {
    @Query("SELECT * FROM cached_verse WHERE id = ${VerseEntity.SINGLETON_ID}")
    suspend fun verse(): VerseEntity?

    /** One row, replaced whole — yesterday's verse never lingers next to today's. */
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun save(verse: VerseEntity)
}
