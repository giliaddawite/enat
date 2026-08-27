import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ktlint)
}

// Crashlytics needs a google-services.json, which only exists once the Firebase
// project is provisioned (and is gitignored — it must never be committed). Applying
// the Firebase plugins conditionally keeps every build green until then; once the
// file is present locally / in CI, crash reporting wires itself in with no further
// build changes.
if (file("google-services.json").exists()) {
    apply(plugin = libs.plugins.google.services.get().pluginId)
    apply(plugin = libs.plugins.crashlytics.get().pluginId)
}

// The real staging URL embeds the GCP project number, so it stays out of version
// control. Supply it as the Gradle property "enatApiBaseUrl": locally in
// android/local.properties (gitignored) as `enatApiBaseUrl=https://...`, in CI via
// the ORG_GRADLE_PROJECT_enatApiBaseUrl environment variable. The fallback is a
// syntactically valid placeholder so a fresh checkout always compiles.
val localProperties =
    Properties().apply {
        val file = rootProject.file("local.properties")
        if (file.exists()) file.inputStream().use { load(it) }
    }
val localApiBaseUrl: String? = localProperties.getProperty("enatApiBaseUrl")
val stagingApiBaseUrl: String =
    providers.gradleProperty("enatApiBaseUrl").orNull
        ?: localApiBaseUrl
        ?: "https://enat-api-staging.example.run.app/v1/"

android {
    namespace = "com.enat.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.enat.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        // Amharic-first with English fallback — no other locales ship.
        resourceConfigurations += listOf("am", "en")
    }

    // Release signing comes from CI secrets (deploy.yml) via environment variables.
    // When they're absent — every local build — the release variant simply builds
    // unsigned instead of failing.
    val keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
    val keystorePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
    val signingKeyAlias = System.getenv("ANDROID_KEY_ALIAS")
    val signingKeyPassword = System.getenv("ANDROID_KEY_PASSWORD")
    val releaseSigningConfigured =
        !keystorePath.isNullOrBlank() &&
            !keystorePassword.isNullOrBlank() &&
            !signingKeyAlias.isNullOrBlank() &&
            !signingKeyPassword.isNullOrBlank()

    if (releaseSigningConfigured) {
        signingConfigs {
            create("release") {
                // CI decodes the keystore into android/ but exports the path relative to
                // the repository root, so try both interpretations before giving up.
                val rawPath = requireNotNull(keystorePath)
                val candidates =
                    listOf(
                        File(rawPath),
                        rootProject.file(rawPath),
                        rootProject.projectDir.parentFile.resolve(rawPath),
                    )
                storeFile = candidates.firstOrNull { it.isFile }
                    ?: error("ANDROID_KEYSTORE_PATH is set but no keystore exists at '$rawPath'")
                storePassword = keystorePassword
                keyAlias = signingKeyAlias
                keyPassword = signingKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField("String", "API_BASE_URL", "\"$stagingApiBaseUrl\"")
        }
        release {
            // The prod backend does not exist yet — it lands with TICKET-003. `.invalid`
            // is an RFC 2606 reserved TLD, so a release build that reaches for the network
            // fails fast at DNS resolution instead of silently talking to the wrong host.
            buildConfigField("String", "API_BASE_URL", "\"https://enat-api-prod.invalid/v1/\"")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
            if (releaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests {
            // Robolectric-backed Compose tests need real resources; android.util.Log in
            // JVM ViewModel tests needs stubbed framework methods.
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }
}

ktlint {
    android.set(true)
    filter {
        exclude { it.file.path.contains("${File.separator}generated${File.separator}") }
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.activity.compose)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.hilt.navigation.compose)

    implementation(libs.retrofit)
    implementation(libs.retrofit.converter.kotlinx.serialization)
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.crashlytics)

    testImplementation(libs.junit)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.turbine)
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(platform(libs.androidx.compose.bom))
    testImplementation(libs.androidx.compose.ui.test.junit4)
    // Merged into the debug manifest so Robolectric-driven Compose tests can
    // launch the test activity.
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
