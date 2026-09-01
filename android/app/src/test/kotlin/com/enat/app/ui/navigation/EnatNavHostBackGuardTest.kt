package com.enat.app.ui.navigation

import android.app.Application
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.dropUnlessResumed
import androidx.navigation.compose.ComposeNavigator
import androidx.navigation.compose.composable
import androidx.navigation.createGraph
import androidx.navigation.testing.TestNavHostController
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The two guard layers on every back arrow (see EnatNavHost). Composing the real
 * EnatNavHost here would drag in Hilt (HomeRoute's hiltViewModel), so each layer
 * is pinned by itself: navigateUp's refuse-on-root property over the real route
 * names, and dropUnlessResumed's lifecycle gate over a handler wrapped exactly
 * like production's.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class EnatNavHostBackGuardTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun doubleNavigateUpFromDigest_cannotPopTheHubAndBlankTheNavHost() {
        val context: Context = ApplicationProvider.getApplicationContext()
        val navController = TestNavHostController(context)
        navController.navigatorProvider.addNavigator(ComposeNavigator())
        navController.graph =
            navController.createGraph(startDestination = EnatRoutes.HUB) {
                composable(EnatRoutes.HUB) {}
                composable(EnatRoutes.DIGEST) {}
            }
        navController.navigate(EnatRoutes.DIGEST)

        // The double-click bug: a second back that fires after the first already
        // popped. With popBackStack this removed the hub too, leaving an empty
        // NavHost (a blank screen on device); navigateUp must refuse instead.
        navController.navigateUp()
        navController.navigateUp()

        assertNotNull(navController.currentDestination)
        assertEquals(EnatRoutes.HUB, navController.currentDestination?.route)
    }

    @Test
    fun dropUnlessResumed_dropsClicksOnceTheEntryLeavesResumed() {
        var backClicks = 0
        val owner = FakeLifecycleOwner()
        owner.moveTo(Lifecycle.State.RESUMED)
        composeTestRule.setContent {
            CompositionLocalProvider(LocalLifecycleOwner provides owner) {
                Button(
                    // Wrapped exactly as EnatNavHost wraps its back handlers.
                    onClick = dropUnlessResumed { backClicks += 1 },
                    modifier = Modifier.testTag("guarded_back"),
                ) {
                    Text("back")
                }
            }
        }

        composeTestRule.onNodeWithTag("guarded_back").performClick()
        composeTestRule.runOnIdle { assertEquals(1, backClicks) }

        // Mid-transition (the state a rapid second click lands in) the entry is
        // no longer RESUMED — the click must be swallowed, not queued.
        composeTestRule.runOnIdle { owner.moveTo(Lifecycle.State.STARTED) }
        composeTestRule.onNodeWithTag("guarded_back").performClick()
        composeTestRule.runOnIdle { assertEquals(1, backClicks) }
    }

    private class FakeLifecycleOwner : LifecycleOwner {
        private val registry = LifecycleRegistry(this)
        override val lifecycle: Lifecycle get() = registry

        fun moveTo(state: Lifecycle.State) {
            registry.currentState = state
        }
    }
}
