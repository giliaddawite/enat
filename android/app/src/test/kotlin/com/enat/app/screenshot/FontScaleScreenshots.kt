package com.enat.app.screenshot

import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsNode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.DeviceConfigurationOverride
import androidx.compose.ui.test.FontScale
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.text.TextLayoutResult
import com.enat.app.ui.theme.EnatTheme
import com.github.takahirom.roborazzi.ExperimentalRoborazziApi
import com.github.takahirom.roborazzi.RoborazziOptions
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.roborazziSystemPropertyOutputDirectory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import java.io.File

/**
 * The two ends of Android's system font-size slider (TICKET-301). Every screenshot
 * test renders at both: the accessibility rule is that layouts survive the maximum
 * without clipping, and the minimum guards the 20sp floor from the other side.
 */
enum class FontScaleExtreme(
    val scale: Float,
    /** Golden file suffix. */
    val label: String,
) {
    /** "Small" in the system display settings. */
    SYSTEM_MINIMUM(0.85f, "font_min"),

    /** 200% — the ceiling of Android 14's non-linear font scaling, the largest Android offers. */
    SYSTEM_MAXIMUM(2.0f, "font_max"),
}

/**
 * The Robolectric qualifiers every screenshot test uses: Amharic resources (what
 * the end user reads), a phone width, and a display tall enough that the whole
 * screen composes at 200% — off-canvas content would be neither captured nor
 * checked for clipping. Density is Robolectric's mdpi default, so 1dp = 1px.
 */
const val SCREENSHOT_QUALIFIERS = "am-w411dp-h2400dp"

/** Sets the screen under test inside the app theme at the requested font scale. */
fun ComposeContentTestRule.setScreenAtFontScale(
    fontScale: FontScaleExtreme,
    content: @Composable () -> Unit,
) {
    setContent {
        DeviceConfigurationOverride(DeviceConfigurationOverride.FontScale(fontScale.scale)) {
            EnatTheme(darkTheme = false, content = content)
        }
    }
}

/**
 * Records or verifies `<outputDir>/<screen>_<state>_<font suffix>.png`. A verify
 * run (CI) fails the test when more than half a percent of the pixels differ —
 * loose enough to absorb anti-aliasing drift between machines, tight enough that
 * any moved or missing line of 20sp+ text still trips it.
 */
@OptIn(ExperimentalRoborazziApi::class)
fun ComposeContentTestRule.captureScreenshot(
    screen: String,
    state: String,
    fontScale: FontScaleExtreme,
) {
    // The Gradle plugin hands the configured outputDir over as a system property.
    val file = File(roborazziSystemPropertyOutputDirectory(), "${screen}_${state}_${fontScale.label}.png")
    onRoot().captureRoboImage(
        filePath = file.path,
        roborazziOptions =
            RoborazziOptions(
                compareOptions = RoborazziOptions.CompareOptions(changeThreshold = CHANGE_THRESHOLD),
            ),
    )
}

/**
 * The no-clipping gate behind the max-font-scale rule: every piece of text on
 * screen must lay out in full (no truncated line, no ellipsis, every laid-out
 * line inside the text's own box) and keep its full size after ancestor
 * clipping (no button, card, or viewport cutting it off). Runs against the
 * unmerged tree so button labels are checked individually, not as part of the
 * button.
 */
fun ComposeContentTestRule.assertNoClippedText() {
    val textNodes =
        onAllNodes(SemanticsMatcher.keyIsDefined(SemanticsProperties.Text), useUnmergedTree = true)
            .fetchSemanticsNodes()
    assertTrue("a screen with no text at all cannot be what mom sees", textNodes.isNotEmpty())
    textNodes.forEach { node ->
        val text = node.config.getOrNull(SemanticsProperties.Text)?.joinToString()
        node.textLayoutResults().forEach { layout ->
            assertFalse("text truncated: «$text»", layout.isTruncated())
            assertTrue("text overflowed its own box: «$text» (${layout.describeLines()})", layout.linesFitInSize())
        }
        val visible = node.boundsInRoot
        assertEquals("text clipped horizontally: «$text»", node.size.width.toFloat(), visible.width, PIXEL_TOLERANCE)
        assertEquals("text clipped vertically: «$text»", node.size.height.toFloat(), visible.height, PIXEL_TOLERANCE)
    }
}

private fun SemanticsNode.textLayoutResults(): List<TextLayoutResult> {
    val results = mutableListOf<TextLayoutResult>()
    config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(results)
    return results
}

private fun TextLayoutResult.isTruncated(): Boolean =
    multiParagraph.didExceedMaxLines || (0 until lineCount).any { isLineEllipsized(it) }

/**
 * Line geometry instead of [TextLayoutResult.hasVisualOverflow]: that flag compares
 * the paragraph's layout width (the full constraint, for aligned text) with the
 * shrink-wrapped node size, and so reports every centered label as overflowing.
 * The glyphs themselves fit when the extent of all lines does.
 */
private fun TextLayoutResult.linesFitInSize(): Boolean {
    val lines = 0 until lineCount
    val contentWidth = lines.maxOf { getLineRight(it) } - lines.minOf { getLineLeft(it) }
    val contentHeight = getLineBottom(lineCount - 1) - getLineTop(0)
    return contentWidth <= size.width + PIXEL_TOLERANCE && contentHeight <= size.height + PIXEL_TOLERANCE
}

private fun TextLayoutResult.describeLines(): String {
    val lines = 0 until lineCount
    return "size=${size.width}x${size.height}, lines=$lineCount, " +
        "left=${lines.minOf { getLineLeft(it) }}, right=${lines.maxOf { getLineRight(it) }}, " +
        "top=${getLineTop(0)}, bottom=${getLineBottom(lineCount - 1)}"
}

private const val CHANGE_THRESHOLD = 0.005f
private const val PIXEL_TOLERANCE = 1f
