package com.enat.app.data.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface FamilyContactDao {
    /** Insertion order — the caregiver adds the most important contact first. */
    @Query("SELECT * FROM family_contacts ORDER BY id")
    fun observeAll(): Flow<List<FamilyContactEntity>>

    @Insert
    suspend fun insert(contact: FamilyContactEntity)

    @Delete
    suspend fun delete(contact: FamilyContactEntity)
}
