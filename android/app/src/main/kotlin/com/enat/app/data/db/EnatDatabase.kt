package com.enat.app.data.db

import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * The app's single Room database: the offline-first cache (CLAUDE.md) plus local-only
 * configuration. Version stays 1 while the app is unreleased — the first shipped build
 * fixes the baseline schema, and migrations start from there.
 */
@Database(
    entities = [FamilyContactEntity::class, DigestEntity::class, DigestItemEntity::class, VerseEntity::class],
    version = 1,
    exportSchema = false,
)
abstract class EnatDatabase : RoomDatabase() {
    abstract fun familyContactDao(): FamilyContactDao

    abstract fun digestDao(): DigestDao

    abstract fun verseDao(): VerseDao
}
