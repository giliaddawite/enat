package com.enat.app.data.digest

/**
 * The four digest buckets, keyed by the backend's stable wire identifiers
 * (`backend/src/domain/summary.ts`). The backend never ships display text for
 * categories — the Amharic labels live in this app's strings.xml.
 */
enum class EmailCategory(
    val wireId: String,
) {
    IMPORTANT("important"),
    BILLS_ACCOUNTS("bills_accounts"),
    FAMILY_PERSONAL("family_personal"),
    PROMOTIONS_OTHER("promotions_other"),
    ;

    companion object {
        /** Unknown future categories land in the catch-all bucket — mail is never dropped. */
        fun fromWireId(wireId: String): EmailCategory = entries.firstOrNull { it.wireId == wireId } ?: PROMOTIONS_OTHER
    }
}

/** One email's card (TICKET-204): sender, Amharic summary, urgency, Gmail deep-link id. */
data class DigestItem(
    val messageId: String,
    val sender: String,
    val subject: String,
    /** Null for category-only (heuristic) results — the card falls back to the subject. */
    val summary: String?,
    val urgent: Boolean,
    val receivedAt: String,
    val category: EmailCategory,
)

data class DigestSection(
    val category: EmailCategory,
    val items: List<DigestItem>,
)

/** The daily digest as the app renders it — `GET /v1/digest` minus `userId`. */
data class Digest(
    val date: String,
    val generatedAt: String,
    val emailCount: Int,
    val sections: List<DigestSection>,
)
