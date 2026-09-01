package com.enat.app.ui.navigation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.enat.app.R
import com.enat.app.ui.components.BackButton
import com.enat.app.ui.family.FamilyCallRoute
import com.enat.app.ui.home.HomeRoute
import com.enat.app.ui.settings.FamilySettingsRoute
import com.enat.app.ui.verse.VersePlaceholderScreen

/** Route names — the single place screen destinations are spelled. */
object EnatRoutes {
    const val HUB = "hub"
    const val DIGEST = "digest"
    const val VERSE = "verse"
    const val FAMILY_CALL = "family-call"
    const val FAMILY_SETTINGS = "family-settings"
}

/**
 * Navigation for the post-setup app. The hub is the launch destination; every
 * other screen is exactly one tap away from it (≤ 2 taps § CLAUDE.md).
 */
@Composable
fun EnatNavHost() {
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
        composable(EnatRoutes.VERSE) {
            VersePlaceholderScreen(onBack = { navController.popBackStack() })
        }
        composable(EnatRoutes.FAMILY_CALL) {
            FamilyCallRoute(onBack = { navController.popBackStack() })
        }
        composable(EnatRoutes.FAMILY_SETTINGS) {
            FamilySettingsRoute(onBack = { navController.popBackStack() })
        }
        composable(EnatRoutes.DIGEST) {
            // TICKET-204 (same PR) replaces this with the real digest screen; the
            // labeled Amharic placeholder keeps the hub button honest until then.
            DigestPlaceholderScreen(onBack = { navController.popBackStack() })
        }
    }
}

@Composable
private fun DigestPlaceholderScreen(onBack: () -> Unit) {
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BackButton(onBack = onBack)
                Text(
                    text = stringResource(R.string.digest_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            Text(
                text = stringResource(R.string.digest_placeholder_body),
                style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.padding(top = 48.dp),
            )
        }
    }
}
