package com.enat.app.di

import com.enat.app.data.greeting.ClockGreetingRepository
import com.enat.app.data.greeting.GreetingRepository
import com.enat.app.notifications.AndroidNotificationPermissionGateway
import com.enat.app.notifications.NotificationPermissionGateway
import com.enat.app.notifications.VerseReminderScheduler
import com.enat.app.notifications.WorkManagerVerseReminderScheduler
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

    @Binds
    abstract fun bindNotificationPermissionGateway(
        impl: AndroidNotificationPermissionGateway,
    ): NotificationPermissionGateway

    @Binds
    abstract fun bindVerseReminderScheduler(impl: WorkManagerVerseReminderScheduler): VerseReminderScheduler

    companion object {
        // Clock is injected (never read ad hoc) so time-dependent logic stays
        // deterministic under test.
        @Provides
        @Singleton
        fun provideClock(): Clock = Clock.systemDefaultZone()
    }
}
