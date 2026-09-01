package com.enat.app.ui.family

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
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.enat.app.R
import com.enat.app.data.family.FamilyContact
import com.enat.app.ui.common.dialPhoneNumber
import com.enat.app.ui.components.BackButton
import com.enat.app.ui.components.PrimaryActionButton

/** Stateful entry point: owns the ViewModel, hoists state, forwards events. */
@Composable
fun FamilyCallRoute(
    onBack: () -> Unit,
    viewModel: FamilyCallViewModel = hiltViewModel(),
) {
    val contacts by viewModel.contacts.collectAsStateWithLifecycle()
    val context = LocalContext.current
    FamilyCallScreen(
        contacts = contacts,
        onCall = { contact -> dialPhoneNumber(context, contact.phoneNumber) },
        onBack = onBack,
    )
}

/** Stateless picker: one oversized button per configured family contact. */
@Composable
fun FamilyCallScreen(
    contacts: List<FamilyContact>,
    onCall: (FamilyContact) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(modifier = modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    // Must survive the maximum system font size without clipping.
                    .verticalScroll(rememberScrollState())
                    .padding(24.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                BackButton(onBack = onBack)
                Text(
                    text = stringResource(R.string.family_call_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            if (contacts.isEmpty()) {
                // Defensive: only reachable if the contacts were deleted while this
                // screen was open — still a worded state, never a blank page.
                Text(
                    text = stringResource(R.string.hub_call_not_configured),
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.error,
                    modifier =
                        Modifier
                            .padding(top = 16.dp)
                            .testTag("family_call_empty"),
                )
            } else {
                Text(
                    text = stringResource(R.string.family_call_choose),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(top = 16.dp),
                )
                contacts.forEach { contact ->
                    PrimaryActionButton(
                        label = contact.name,
                        onClick = { onCall(contact) },
                        minHeight = 96.dp,
                        textStyle = MaterialTheme.typography.headlineMedium,
                        modifier = Modifier.padding(top = 16.dp),
                    )
                }
            }
        }
    }
}
