package com.enat.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.enat.app.ui.navigation.EnatNavHost
import com.enat.app.ui.setup.SetupRoute
import com.enat.app.ui.theme.EnatTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The daily verse notification's deep link (TICKET-205): one extra, read
        // once here — no deep-link framework for a single destination. The NavHost
        // guards against replaying it on configuration changes.
        val openVerse = intent.getBooleanExtra(EXTRA_OPEN_VERSE, false)
        setContent {
            EnatTheme {
                // targetSdk 35 enforces edge-to-edge: without this, every screen's
                // header (and the back arrow's touch target) draws under the status
                // bar. The Surface paints the theme background behind the bar; the
                // padded Box keeps all content below it. Applied once here so no
                // screen has to remember it.
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background,
                ) {
                    Box(modifier = Modifier.statusBarsPadding()) {
                        val viewModel: MainViewModel = hiltViewModel()
                        val showSetup by viewModel.showSetup.collectAsStateWithLifecycle()
                        if (showSetup) {
                            SetupRoute(onSetupFinished = viewModel::onSetupFinished)
                        } else {
                            EnatNavHost(
                                onRestartSetup = viewModel::restartSetup,
                                openVerseOnLaunch = openVerse,
                            )
                        }
                    }
                }
            }
        }
    }

    companion object {
        /** Set by the verse notification's content intent (VerseNotificationWorker). */
        const val EXTRA_OPEN_VERSE = "com.enat.app.extra.OPEN_VERSE"
    }
}
