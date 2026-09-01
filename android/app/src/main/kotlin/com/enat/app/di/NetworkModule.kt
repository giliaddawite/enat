package com.enat.app.di

import com.enat.app.BuildConfig
import com.enat.app.data.auth.AuthApi
import com.enat.app.data.auth.AuthInterceptor
import com.enat.app.data.digest.DigestApi
import com.enat.app.data.verse.VerseApi
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun provideJson(): Json =
        Json {
            // The /v1/ contract may gain fields; old clients must keep parsing.
            ignoreUnknownKeys = true
        }

    // Every API call is authenticated (TICKET-204): the interceptor silently mints
    // a Google ID token per request/session and attaches it as a Bearer header.
    @Provides
    @Singleton
    fun provideOkHttpClient(authInterceptor: AuthInterceptor): OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .addInterceptor(authInterceptor)
            .build()

    // BuildConfig.API_BASE_URL already ends in /v1/ — the app never calls
    // unversioned paths.
    @Provides
    @Singleton
    fun provideRetrofit(
        okHttpClient: OkHttpClient,
        json: Json,
    ): Retrofit =
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(okHttpClient)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

    @Provides
    @Singleton
    fun provideAuthApi(retrofit: Retrofit): AuthApi = retrofit.create(AuthApi::class.java)

    @Provides
    @Singleton
    fun provideDigestApi(retrofit: Retrofit): DigestApi = retrofit.create(DigestApi::class.java)

    @Provides
    @Singleton
    fun provideVerseApi(retrofit: Retrofit): VerseApi = retrofit.create(VerseApi::class.java)
}
