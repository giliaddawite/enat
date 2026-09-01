package com.enat.app.di

import com.enat.app.BuildConfig
import com.enat.app.data.auth.CredentialManagerSignInGateway
import com.enat.app.data.auth.GmailAuthorizationGateway
import com.enat.app.data.auth.GmailConsentRepository
import com.enat.app.data.auth.GoogleAuthConfig
import com.enat.app.data.auth.GoogleSignInGateway
import com.enat.app.data.auth.IdTokenProvider
import com.enat.app.data.auth.NetworkGmailConsentRepository
import com.enat.app.data.auth.PlayServicesGmailAuthorizationGateway
import com.enat.app.data.auth.SessionIdTokenProvider
import com.enat.app.data.setup.PreferencesSetupStateRepository
import com.enat.app.data.setup.SetupStateRepository
import dagger.Binds
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class AuthModule {
    @Binds
    abstract fun bindGoogleSignInGateway(impl: CredentialManagerSignInGateway): GoogleSignInGateway

    @Binds
    abstract fun bindGmailAuthorizationGateway(impl: PlayServicesGmailAuthorizationGateway): GmailAuthorizationGateway

    @Binds
    abstract fun bindGmailConsentRepository(impl: NetworkGmailConsentRepository): GmailConsentRepository

    @Binds
    @Singleton
    abstract fun bindSetupStateRepository(impl: PreferencesSetupStateRepository): SetupStateRepository

    @Binds
    abstract fun bindIdTokenProvider(impl: SessionIdTokenProvider): IdTokenProvider

    companion object {
        @Provides
        fun provideGoogleAuthConfig(): GoogleAuthConfig = GoogleAuthConfig(BuildConfig.GOOGLE_WEB_CLIENT_ID)
    }
}
