package com.enat.app.ui.settings

import android.app.Application
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.enat.app.R
import com.enat.app.data.family.FamilyContact
import com.enat.app.ui.theme.EnatTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FamilySettingsScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun setScreen(
        uiState: FamilySettingsUiState,
        onAddContact: () -> Unit = {},
        onRemoveContact: (Long) -> Unit = {},
        onBack: () -> Unit = {},
    ) {
        composeTestRule.setContent {
            EnatTheme {
                FamilySettingsScreen(
                    uiState = uiState,
                    onNameChanged = {},
                    onPhoneChanged = {},
                    onAddContact = onAddContact,
                    onRemoveContact = onRemoveContact,
                    onBack = onBack,
                )
            }
        }
    }

    @Test
    fun emptyState_showsPlainLanguageMessage() {
        setScreen(FamilySettingsUiState())

        composeTestRule
            .onNodeWithText(context.getString(R.string.settings_empty))
            .assertIsDisplayed()
    }

    @Test
    fun contacts_areListedWithLabeledDeleteButtons() {
        var removedId: Long? = null
        setScreen(
            FamilySettingsUiState(
                contacts = listOf(FamilyContact(id = 5, name = "ሙሉ", phoneNumber = "+15551234567")),
            ),
            onRemoveContact = { removedId = it },
        )

        composeTestRule.onNodeWithText("ሙሉ").assertIsDisplayed()
        val deleteButton =
            composeTestRule.onNodeWithContentDescription(
                context.getString(R.string.settings_delete_description, "ሙሉ"),
            )
        deleteButton.assertHeightIsAtLeast(64.dp)
        deleteButton.performClick()

        assertEquals(5L, removedId)
    }

    @Test
    fun confirmation_isVisibleAndAPoliteLiveRegion() {
        setScreen(FamilySettingsUiState(confirmation = ContactChange.ADDED))

        composeTestRule
            .onNodeWithText(context.getString(R.string.settings_contact_added))
            .assertIsDisplayed()
            .assert(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.LiveRegion,
                    LiveRegionMode.Polite,
                ),
            )
    }

    @Test
    fun validationError_isVisibleWhenSet() {
        setScreen(FamilySettingsUiState(showValidationError = true))

        composeTestRule
            .onNodeWithText(context.getString(R.string.settings_validation_error))
            .assertIsDisplayed()
    }

    @Test
    fun addButton_meetsTouchTargetAndEmitsEvent() {
        var added = false
        setScreen(FamilySettingsUiState(), onAddContact = { added = true })

        val addButton = composeTestRule.onNodeWithText(context.getString(R.string.settings_add_button))
        addButton.assertHeightIsAtLeast(64.dp)
        addButton.performClick()

        assertTrue(added)
    }

    @Test
    fun backButton_meetsTouchTargetAndEmitsEvent() {
        var wentBack = false
        setScreen(FamilySettingsUiState(), onBack = { wentBack = true })

        val backButton =
            composeTestRule.onNodeWithContentDescription(context.getString(R.string.back_button))
        backButton.assertHeightIsAtLeast(64.dp)
        backButton.performClick()

        assertTrue(wentBack)
    }

    @Test
    fun inputFields_meetTouchTargets() {
        setScreen(FamilySettingsUiState())

        composeTestRule.onNodeWithTag("settings_name_input").assertHeightIsAtLeast(64.dp)
        composeTestRule.onNodeWithTag("settings_phone_input").assertHeightIsAtLeast(64.dp)
    }
}
