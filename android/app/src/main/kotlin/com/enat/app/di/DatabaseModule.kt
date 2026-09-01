package com.enat.app.di

import android.content.Context
import androidx.room.Room
import com.enat.app.data.db.DigestDao
import com.enat.app.data.db.EnatDatabase
import com.enat.app.data.db.FamilyContactDao
import com.enat.app.data.db.VerseDao
import com.enat.app.data.digest.DigestRepository
import com.enat.app.data.digest.NetworkDigestRepository
import com.enat.app.data.family.FamilyContactRepository
import com.enat.app.data.family.RoomFamilyContactRepository
import com.enat.app.data.verse.NetworkVerseRepository
import com.enat.app.data.verse.VerseRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class DatabaseModule {
    @Binds
    abstract fun bindFamilyContactRepository(impl: RoomFamilyContactRepository): FamilyContactRepository

    @Binds
    abstract fun bindDigestRepository(impl: NetworkDigestRepository): DigestRepository

    @Binds
    abstract fun bindVerseRepository(impl: NetworkVerseRepository): VerseRepository

    companion object {
        @Provides
        @Singleton
        fun provideDatabase(
            @ApplicationContext context: Context,
        ): EnatDatabase = Room.databaseBuilder(context, EnatDatabase::class.java, "enat.db").build()

        @Provides
        fun provideFamilyContactDao(database: EnatDatabase): FamilyContactDao = database.familyContactDao()

        @Provides
        fun provideDigestDao(database: EnatDatabase): DigestDao = database.digestDao()

        @Provides
        fun provideVerseDao(database: EnatDatabase): VerseDao = database.verseDao()
    }
}
