package com.enat.app.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.enat.app.R
import com.enat.app.data.family.FamilyContact
import com.enat.app.ui.components.BackButton
import com.enat.app.ui.components.PrimaryActionButton

/** Stateful entry point: owns the ViewModel, hoists state, forwards events. */
@Composable
fun FamilySettingsRoute(
    onBack: () -> Unit,
    viewModel: FamilySettingsViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    FamilySettingsScreen(
        uiState = uiState,
        onNameChanged = viewModel::onNameChanged,
        onPhoneChanged = viewModel::onPhoneChanged,
        onAddContact = viewModel::addContact,
        onRemoveContact = viewModel::removeContact,
        onBack = onBack,
    )
}

/**
 * The caregiver's quick-dial editor. Reached only by the hub's hidden long-press,
 * but once open it follows every accessibility rule like any other screen: 64dp
 * targets, ≥20sp text, TalkBack labels, no gesture-only interactions.
 */
@Composable
fun FamilySettingsScreen(
    uiState: FamilySettingsUiState,
    onNameChanged: (String) -> Unit,
    onPhoneChanged: (String) -> Unit,
    onAddContact: () -> Unit,
    onRemoveContact: (Long) -> Unit,
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
                    text = stringResource(R.string.settings_title),
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(start = 8.dp),
                )
            }
            Text(
                text = stringResource(R.string.settings_intro),
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 16.dp),
            )
            if (uiState.contacts.isEmpty()) {
                Text(
                    text = stringResource(R.string.settings_empty),
                    style = MaterialTheme.typography.titleLarge,
                    modifier =
                        Modifier
                            .padding(top = 24.dp)
                            .testTag("settings_empty"),
                )
            } else {
                uiState.contacts.forEach { contact ->
                    ContactRow(contact = contact, onRemoveContact = onRemoveContact)
                }
            }
            OutlinedTextField(
                value = uiState.nameInput,
                onValueChange = onNameChanged,
                label = {
                    Text(
                        text = stringResource(R.string.settings_name_label),
                        style = MaterialTheme.typography.labelMedium,
                    )
                },
                textStyle = MaterialTheme.typography.bodyLarge,
                singleLine = true,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 24.dp)
                        // 64dp touch target for the field itself.
                        .heightIn(min = 64.dp)
                        .testTag("settings_name_input"),
            )
            OutlinedTextField(
                value = uiState.phoneInput,
                onValueChange = onPhoneChanged,
                label = {
                    Text(
                        text = stringResource(R.string.settings_phone_label),
                        style = MaterialTheme.typography.labelMedium,
                    )
                },
                textStyle = MaterialTheme.typography.bodyLarge,
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 16.dp)
                        .heightIn(min = 64.dp)
                        .testTag("settings_phone_input"),
            )
            if (uiState.showValidationError) {
                Text(
                    text = stringResource(R.string.settings_validation_error),
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier =
                        Modifier
                            .padding(top = 16.dp)
                            .testTag("settings_validation_error")
                            // Appears in response to a tap; announce without stealing focus.
                            .semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            PrimaryActionButton(
                label = stringResource(R.string.settings_add_button),
                onClick = onAddContact,
                modifier = Modifier.padding(top = 24.dp),
            )
        }
    }
}

@Composable
private fun ContactRow(
    contact: FamilyContact,
    onRemoveContact: (Long) -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(top = 16.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = contact.name, style = MaterialTheme.typography.titleLarge)
            Text(
                text = contact.phoneNumber,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(
            onClick = { onRemoveContact(contact.id) },
            modifier = Modifier.size(64.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.Delete,
                // Names the person, so TalkBack never announces a bare "delete".
                contentDescription = stringResource(R.string.settings_delete_description, contact.name),
                tint = MaterialTheme.colorScheme.error,
                modifier = Modifier.size(36.dp),
            )
        }
    }
}
