package com.enat.app.data.db

import android.app.Application
import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class DigestDaoTest {
    private lateinit var database: EnatDatabase
    private lateinit var dao: DigestDao

    @Before
    fun createDatabase() {
        val context: Context = ApplicationProvider.getApplicationContext()
        database =
            Room.inMemoryDatabaseBuilder(context, EnatDatabase::class.java)
                .allowMainThreadQueries()
                .build()
        dao = database.digestDao()
    }

    @After
    fun closeDatabase() {
        database.close()
    }

    private fun item(
        messageId: String,
        sectionOrder: Int,
        itemOrder: Int,
    ) = DigestItemEntity(
        messageId = messageId,
        category = "important",
        sectionOrder = sectionOrder,
        itemOrder = itemOrder,
        sender = "ባንክ",
        subject = "Statement",
        summary = "የባንክ መግለጫ ደርሷል።",
        urgent = false,
        receivedAt = "2026-08-25T09:00:00Z",
    )

    private fun header(date: String = "2026-08-25") =
        DigestEntity(date = date, generatedAt = "${date}T10:00:00Z", emailCount = 2, etag = "\"abc\"")

    @Test
    fun `empty cache reads as null`() =
        runTest {
            assertNull(dao.digest())
            assertEquals(emptyList<DigestItemEntity>(), dao.items())
        }

    @Test
    fun `replace stores the digest and returns items in section then item order`() =
        runTest {
            dao.replace(header(), listOf(item("b", 1, 0), item("a", 0, 1), item("c", 0, 0)))

            assertEquals("2026-08-25", dao.digest()?.date)
            assertEquals(listOf("c", "a", "b"), dao.items().map { it.messageId })
        }

    @Test
    fun `replace swaps out the previous digest entirely`() =
        runTest {
            dao.replace(header("2026-08-24"), listOf(item("old", 0, 0)))

            dao.replace(header("2026-08-25"), listOf(item("new", 0, 0)))

            assertEquals("2026-08-25", dao.digest()?.date)
            assertEquals(listOf("new"), dao.items().map { it.messageId })
            assertNull(dao.item("old"))
        }

    @Test
    fun `item looks up one message by id`() =
        runTest {
            dao.replace(header(), listOf(item("m1", 0, 0)))

            assertEquals("ባንክ", dao.item("m1")?.sender)
            assertNull(dao.item("missing"))
        }
}
