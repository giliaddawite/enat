package com.enat.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
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
        setContent {
            EnatTheme {
                val viewModel: MainViewModel = hiltViewModel()
                val showSetup by viewModel.showSetup.collectAsStateWithLifecycle()
                if (showSetup) {
                    SetupRoute(onSetupFinished = viewModel::onSetupFinished)
                } else {
                    EnatNavHost()
                }
            }
        }
    }
}
