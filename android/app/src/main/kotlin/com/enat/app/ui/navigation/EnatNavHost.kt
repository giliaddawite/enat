package com.enat.app.ui.navigation

import androidx.compose.runtime.Composable
import androidx.lifecycle.compose.dropUnlessResumed
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.enat.app.ui.digest.DigestDetailRoute
import com.enat.app.ui.digest.DigestDetailViewModel
import com.enat.app.ui.digest.DigestRoute
import com.enat.app.ui.family.FamilyCallRoute
import com.enat.app.ui.home.HomeRoute
import com.enat.app.ui.settings.FamilySettingsRoute
import com.enat.app.ui.verse.VersePlaceholderScreen

/** Route names — the single place screen destinations are spelled. */
object EnatRoutes {
    const val HUB = "hub"
    const val DIGEST = "digest"
    const val DIGEST_DETAIL = "digest/{${DigestDetailViewModel.MESSAGE_ID_ARG}}"
    const val VERSE = "verse"
    const val FAMILY_CALL = "family-call"
    const val FAMILY_SETTINGS = "family-settings"

    fun digestDetail(messageId: String): String = "digest/$messageId"
}

/**
 * Navigation for the post-setup app. The hub is the launch destination; every
 * other screen is exactly one tap away from it (≤ 2 taps § CLAUDE.md).
 *
 * [onRestartSetup] re-enters the setup flow — the fix for a revoked Gmail grant,
 * a never-connected account, or a dead sign-in session (TICKET-204).
 *
 * Every back arrow is guarded twice, and both layers matter. [dropUnlessResumed]
 * swallows clicks unless this entry's lifecycle is RESUMED, so a tap during a
 * transition — or the second tap of a rapid double-click, which lands after the
 * entry leaves RESUMED — never fires. And [androidx.navigation.NavController.navigateUp]
 * (unlike a bare popBackStack) refuses to pop the last entry, so even a tap that
 * slips past the lifecycle gate cannot pop the hub and leave a blank NavHost —
 * exactly the bug a double-clicked back arrow produced on device.
 */
@Composable
fun EnatNavHost(onRestartSetup: () -> Unit) {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = EnatRoutes.HUB) {
        composable(EnatRoutes.HUB) {
            HomeRoute(
                onOpenDigest = { navController.navigate(EnatRoutes.DIGEST) },
                onOpenVerse = { navController.navigate(EnatRoutes.VERSE) },
                onOpenFamilyPicker = { navController.navigate(EnatRoutes.FAMILY_CALL) },
                onOpenSettings = { navController.navigate(EnatRoutes.FAMILY_SETTINGS) },
            )
        }
        composable(EnatRoutes.DIGEST) {
            DigestRoute(
                onBack = dropUnlessResumed { navController.navigateUp() },
                onOpenDetail = { messageId -> navController.navigate(EnatRoutes.digestDetail(messageId)) },
                onReconnect = onRestartSetup,
                onNavigateToSetup = onRestartSetup,
            )
        }
        composable(
            EnatRoutes.DIGEST_DETAIL,
            arguments =
                listOf(
                    navArgument(DigestDetailViewModel.MESSAGE_ID_ARG) { type = NavType.StringType },
                ),
        ) {
            DigestDetailRoute(onBack = dropUnlessResumed { navController.navigateUp() })
        }
        composable(EnatRoutes.VERSE) {
            VersePlaceholderScreen(onBack = dropUnlessResumed { navController.navigateUp() })
        }
        composable(EnatRoutes.FAMILY_CALL) {
            FamilyCallRoute(onBack = dropUnlessResumed { navController.navigateUp() })
        }
        composable(EnatRoutes.FAMILY_SETTINGS) {
            FamilySettingsRoute(onBack = dropUnlessResumed { navController.navigateUp() })
        }
    }
}
