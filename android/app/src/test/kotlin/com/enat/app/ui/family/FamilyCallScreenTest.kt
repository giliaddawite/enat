package com.enat.app.ui.family

import android.app.Application
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import com.enat.app.R
import com.enat.app.data.family.FamilyContact
import com.enat.app.ui.theme.EnatTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class FamilyCallScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    private val context: Context = ApplicationProvider.getApplicationContext()

    private val contacts =
        listOf(
            FamilyContact(id = 1, name = "ሙሉ", phoneNumber = "+15551234567"),
            FamilyContact(id = 2, name = "ሳራ", phoneNumber = "+15559876543"),
        )

    @Test
    fun everyContact_getsAnOversizedButton() {
        composeTestRule.setContent {
            EnatTheme {
                FamilyCallScreen(contacts = contacts, onCall = {}, onBack = {})
            }
        }

        composeTestRule
            .onNodeWithText(context.getString(R.string.family_call_choose))
            .assertIsDisplayed()
        contacts.forEach { contact ->
            composeTestRule.onNodeWithText(contact.name).assertHeightIsAtLeast(96.dp)
        }
    }

    @Test
    fun tappingAContact_emitsCallWithThatContact() {
        var called: FamilyContact? = null
        composeTestRule.setContent {
            EnatTheme {
                FamilyCallScreen(contacts = contacts, onCall = { called = it }, onBack = {})
            }
        }

        composeTestRule.onNodeWithText("ሳራ").performClick()

        assertEquals("+15559876543", called?.phoneNumber)
    }
}
