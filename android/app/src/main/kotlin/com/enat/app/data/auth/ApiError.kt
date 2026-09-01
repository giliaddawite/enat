package com.enat.app.data.auth

import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.ResponseBody
import java.io.IOException

/**
 * Stable machine-readable codes from the backend's standard error envelope,
 * `{"error":{"code","message","requestId"}}`. Single source of truth for the exact
 * strings — screens branch on these constants, never on prose.
 */
object ApiErrorCode {
    /** Google rejected the auth code (expired or already used) — a fresh authorization fixes it. */
    const val INVALID_GRANT = "invalid_grant"

    /** The exchange returned no refresh token — re-run authorization with forced consent. */
    const val NO_REFRESH_TOKEN = "no_refresh_token"

    /** The user unchecked one or both Gmail scopes on the consent screen. */
    const val INSUFFICIENT_SCOPE = "insufficient_scope"

    /**
     * The exchange's id_token is missing or belongs to a different account than the
     * signed-in one. Generic retry is the agreed handling — re-running the flow lets
     * the installer pick the matching account.
     */
    const val ACCOUNT_MISMATCH = "account_mismatch"

    /**
     * The stored Gmail grant was revoked (409 from POST /v1/digest/generate) — show
     * [com.enat.app.ui.components.ReconnectCard] and re-run the consent flow. Distinct
     * from the backend's "gmail_not_connected", which means consent never happened.
     */
    const val GMAIL_RECONNECT_REQUIRED = "gmail_reconnect_required"

    /**
     * Gmail consent never happened for this account (409 from POST
     * /v1/digest/generate) — route back to first-run setup, not the reconnect card.
     */
    const val GMAIL_NOT_CONNECTED = "gmail_not_connected"
}

@Serializable
data class ApiErrorEnvelope(
    val error: ApiErrorBody,
)

@Serializable
data class ApiErrorBody(
    val code: String,
)

/**
 * Reads the machine-readable `error.code` out of an error response body, or null
 * when there is none to be had (missing body, unreadable stream, non-envelope
 * content from a proxy or crash page). Callers treat null as the generic case.
 */
fun Json.apiErrorCode(errorBody: ResponseBody?): String? {
    if (errorBody == null) return null
    val body =
        try {
            errorBody.source().use { source ->
                // The envelope is tiny; cap the read so a hostile intermediary
                // cannot balloon memory with an arbitrarily large error body. A
                // truncated body simply fails to parse and lands on the generic path.
                source.request(MAX_ERROR_BODY_BYTES)
                source.buffer.readUtf8(minOf(source.buffer.size, MAX_ERROR_BODY_BYTES))
            }
        } catch (unreadable: IOException) {
            return null
        }
    return try {
        decodeFromString<ApiErrorEnvelope>(body).error.code
    } catch (malformed: SerializationException) {
        null
    }
}

private const val MAX_ERROR_BODY_BYTES = 8L * 1024
