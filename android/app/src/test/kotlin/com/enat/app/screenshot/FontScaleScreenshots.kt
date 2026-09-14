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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import java.io.File

/**
 * The smallest and largest font scales a user can pick on Android (TICKET-301).
 * Every screenshot test renders at both: the accessibility rule is that layouts
 * survive the maximum without clipping, and the minimum guards the 20sp floor
 * from the other side.
 */
enum class FontScaleExtreme(
    val scale: Float,
    /** Golden file suffix. */
    val label: String,
) {
    /** The floor of Settings > Display > Font size ("Small"); that slider tops out at 1.3. */
    SYSTEM_MINIMUM(0.85f, "font_min"),

    /**
     * 200%, the cap of Settings > Accessibility > Font size — the largest Android
     * offers on any version. (Android 14 made scaling non-linear; it did not raise the cap.)
     */
    SYSTEM_MAXIMUM(2.0f, "font_max"),
}

/**
 * The Robolectric qualifiers every screenshot test uses: Amharic resources (what
 * the end user reads), a phone width, and a display tall enough that the whole
 * screen composes at 200% — off-canvas content would be neither captured nor
 * checked for clipping. Density is Robolectric's mdpi default, so 1dp = 1px.
 */
const val SCREENSHOT_QUALIFIERS = "am-w411dp-h2400dp"

/**
 * Sets the screen under test inside the app theme at the requested font scale,
 * with the Compose clock under manual control from the first frame: an
 * auto-advancing clock cancels infinite animations outright, so the loading
 * spinner would be frozen at its zero-length start rather than at a visible,
 * repeatable phase.
 */
fun ComposeContentTestRule.setScreenAtFontScale(
    fontScale: FontScaleExtreme,
    content: @Composable () -> Unit,
) {
    mainClock.autoAdvance = false
    setContent {
        DeviceConfigurationOverride(DeviceConfigurationOverride.FontScale(fontScale.scale)) {
            EnatTheme(darkTheme = false, content = content)
        }
    }
    mainClock.advanceTimeByFrame()
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
    freezeAnimations()
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
 * Advances the manually driven clock to one fixed instant after composition, so
 * anything animating (the loading spinner) is drawn at the same phase in every
 * run — a golden must not depend on when the capture happened to land.
 */
private fun ComposeContentTestRule.freezeAnimations() {
    mainClock.advanceTimeBy(FROZEN_ANIMATION_TIME_MILLIS)
    waitForIdle()
}

/**
 * The text-level guarantee behind the max-font-scale rule: every Text node's own
 * resolved box fits all of its laid-out lines, and no line was dropped (maxLines)
 * or ellipsized. It says nothing about ancestors — a parent that draw-clips a
 * correctly laid-out Text is only caught by the golden image. Runs against the
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
private const val FROZEN_ANIMATION_TIME_MILLIS = 500L
