package com.enat.app.data.auth

import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException
import java.net.HttpURLConnection
import javax.inject.Inject

/**
 * Thrown (as an IOException, per the [Interceptor] contract) when no Google
 * credential can be minted. Repositories map it to a signed-out result that
 * routes back to the setup flow — distinct from plain connectivity failures.
 */
class SignedOutException : IOException("No Google credential is available")

/**
 * Attaches `Authorization: Bearer <Google ID token>` to every API request —
 * the app-wide auth plumbing (TICKET-204). Requests that already carry an
 * Authorization header (the setup flow's explicit one) pass through untouched.
 */
class AuthInterceptor
    @Inject
    constructor(
        private val tokenProvider: IdTokenProvider,
    ) : Interceptor {
        override fun intercept(chain: Interceptor.Chain): Response {
            val request = chain.request()
            if (request.header(AUTHORIZATION) != null) {
                return chain.proceed(request)
            }
            // runBlocking is safe here: OkHttp interceptors run on OkHttp's own
            // background threads, never the main thread.
            val token = runBlocking { tokenProvider.idToken() } ?: throw SignedOutException()
            val response =
                chain.proceed(
                    request.newBuilder()
                        .header(AUTHORIZATION, "Bearer $token")
                        .build(),
                )
            if (response.code == HttpURLConnection.HTTP_UNAUTHORIZED) {
                // The server rejected a token the cache thought was fresh — drop it
                // so the next request mints a new one.
                tokenProvider.invalidate()
            }
            return response
        }

        private companion object {
            const val AUTHORIZATION = "Authorization"
        }
    }
