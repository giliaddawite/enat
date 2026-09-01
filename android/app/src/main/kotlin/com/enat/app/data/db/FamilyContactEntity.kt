package com.enat.app.data.db

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * One quick-dial family contact (TICKET-203). Stored locally only — the ticket rules
 * out server sync, and nothing about who mom calls ever leaves the device.
 */
@Entity(tableName = "family_contacts")
data class FamilyContactEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val phoneNumber: String,
)
