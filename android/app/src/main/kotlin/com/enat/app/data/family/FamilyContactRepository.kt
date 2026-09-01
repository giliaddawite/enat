package com.enat.app.data.family

import com.enat.app.data.db.FamilyContactDao
import com.enat.app.data.db.FamilyContactEntity
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

data class FamilyContact(
    val id: Long,
    val name: String,
    val phoneNumber: String,
)

/**
 * Quick-dial family contacts (TICKET-203), stored on-device only. The hub's
 * «ቤተሰብ ደውል» button dials these; the hidden settings screen edits them.
 */
interface FamilyContactRepository {
    fun contacts(): Flow<List<FamilyContact>>

    suspend fun add(
        name: String,
        phoneNumber: String,
    )

    suspend fun remove(id: Long)
}

class RoomFamilyContactRepository
    @Inject
    constructor(
        private val dao: FamilyContactDao,
    ) : FamilyContactRepository {
        override fun contacts(): Flow<List<FamilyContact>> =
            dao.observeAll().map { entities ->
                entities.map { FamilyContact(id = it.id, name = it.name, phoneNumber = it.phoneNumber) }
            }

        override suspend fun add(
            name: String,
            phoneNumber: String,
        ) {
            dao.insert(FamilyContactEntity(name = name, phoneNumber = phoneNumber))
        }

        override suspend fun remove(id: Long) {
            // Delete matches on the primary key only, so placeholder fields are fine.
            dao.delete(FamilyContactEntity(id = id, name = "", phoneNumber = ""))
        }
    }
