package com.enat.app.data.db

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FamilyContactDaoTest {
    private lateinit var database: EnatDatabase
    private lateinit var dao: FamilyContactDao

    @Before
    fun createDatabase() {
        val context: Context = ApplicationProvider.getApplicationContext()
        database =
            Room.inMemoryDatabaseBuilder(context, EnatDatabase::class.java)
                .allowMainThreadQueries()
                .build()
        dao = database.familyContactDao()
    }

    @After
    fun closeDatabase() {
        database.close()
    }

    @Test
    fun `insert and observe keeps insertion order`() =
        runTest {
            dao.insert(FamilyContactEntity(name = "ሙሉ", phoneNumber = "+15551234567"))
            dao.insert(FamilyContactEntity(name = "ሳራ", phoneNumber = "+15559876543"))

            val contacts = dao.observeAll().first()

            assertEquals(listOf("ሙሉ", "ሳራ"), contacts.map { it.name })
            assertEquals(listOf("+15551234567", "+15559876543"), contacts.map { it.phoneNumber })
        }

    @Test
    fun `delete removes by id`() =
        runTest {
            dao.insert(FamilyContactEntity(name = "ሙሉ", phoneNumber = "+15551234567"))
            dao.insert(FamilyContactEntity(name = "ሳራ", phoneNumber = "+15559876543"))
            val first = dao.observeAll().first().first()

            dao.delete(FamilyContactEntity(id = first.id, name = "", phoneNumber = ""))

            assertEquals(listOf("ሳራ"), dao.observeAll().first().map { it.name })
        }
}
