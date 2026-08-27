# App-specific R8 keep rules. Retrofit service interfaces and kotlinx.serialization
# models get their rules from the libraries' bundled consumer rules; add app rules
# here only when a release-build crash proves they're needed.

# Strip chatty logging from release builds. Warnings and errors stay — failures
# must surface — but per CLAUDE.md they must never contain mail content or PII:
# log message IDs and counts, not bodies.
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
