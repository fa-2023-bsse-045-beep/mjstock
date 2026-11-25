# Keep WebKit and JavaScript interfaces safe from obfuscation
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# AndroidX WebKit
-keep class androidx.webkit.** { *; }

# Material and Support
-keep class com.google.android.material.** { *; }
-dontwarn com.google.android.material.**
