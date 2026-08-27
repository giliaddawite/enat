package com.enat.app.di

import com.enat.app.data.greeting.ClockGreetingRepository
import com.enat.app.data.greeting.GreetingRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.time.Clock
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class AppModule {
    @Binds
    abstract fun bindGreetingRepository(impl: ClockGreetingRepository): GreetingRepository

    companion object {
        // Clock is injected (never read ad hoc) so time-dependent logic stays
        // deterministic under test.
        @Provides
        @Singleton
        fun provideClock(): Clock = Clock.systemDefaultZone()
    }
}
