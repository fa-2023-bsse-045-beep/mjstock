# MJ AUTOS — Android Mobile Application

This folder contains the complete, native Android application for **MJ AUTOS**. It turns the existing Node.js + Neon PostgreSQL billing & stock web application into a mobile app experience using a high-performance native Android wrapper.

---

## Architecture & Reusability

- **100% Reuse:** The Android app loads and interacts directly with the existing website backend, Neon database, APIs, user roles, authentication cookies, and responsive UI.
- **Zero Duplicate Backend:** No separate database or duplicated API endpoints.
- **Modern Android Stack:** Built for modern Android versions (Min SDK: 24 `Android 7.0`, Target SDK: 35 `Android 15`).

---

## Native Features Implemented

1. **Native POS Printing (`window.print()`):**
   - Directly intercepts `window.print()` calls from the website and invokes Android's native `PrintManager`.
   - Supports 80mm thermal receipt printers (Bluetooth, Wi-Fi, USB) and standard A4 printers.
2. **Session & Cookie Persistence:**
   - Full `CookieManager` third-party cookie synchronization to persist JWT login sessions across app restarts.
3. **Offline & Connectivity Guard:**
   - Native network listener monitors connectivity state in real time.
   - Shows a clean offline screen with a "Retry" button when disconnected, and automatically reloads when internet is restored.
4. **Pull-to-Refresh (`SwipeRefreshLayout`):**
   - Allows users to swipe down to refresh stock levels and billing data. Scroll-aware to prevent conflicts with web page scrolling.
5. **File Uploads & Camera Capture:**
   - `<input type="file">` handled via `WebChromeClient.onShowFileChooser` and Android `FileProvider`, supporting camera photo capture and gallery selection.
6. **File Downloads (CSV & PDF):**
   - Stock movement CSV exports and invoice downloads are handled via Android's `DownloadManager` with notification updates.
7. **External Links & Communications:**
   - WhatsApp links (`whatsapp:` / `wa.me`), phone calls (`tel:`), emails (`mailto:`), and SMS automatically open their respective native Android apps.
8. **Android Back-Button Navigation:**
   - Uses `OnBackPressedDispatcher` to navigate back through website history. Pressing back twice on the root screen cleanly exits the app.
9. **Modern Splash Screen:**
   - Powered by `androidx.core:core-splashscreen` with the MJ AUTOS brand icon and `#151A24` theme.
10. **Configurable Server URL:**
    - Default website URL defined in `res/values/strings.xml` (`website_url`).
    - An in-app "Server Settings" dialog allows switching between production and local development IP (e.g., `http://192.168.1.x:3000`) without recompiling.

---

## Building the App

Open a terminal in the `android/` directory:

### 1. Build Debug APK (For local testing)
```powershell
.\gradlew.bat assembleDebug
```
Output: `android/app/build/outputs/apk/debug/app-debug.apk`

### 2. Build Release Signed APK (For manual installation / distribution)
```powershell
.\gradlew.bat assembleRelease
```
Output: `android/app/build/outputs/apk/release/app-release.apk`

### 3. Build Google Play Store Android App Bundle (.aab)
```powershell
.\gradlew.bat bundleRelease
```
Output: `android/app/build/outputs/bundle/release/app-release.aab`

---

## Release Signing & Keystore

The project includes an automatic release signing configuration configured in `android/app/build.gradle`.

- **Keystore Location:** `android/app/release-keystore.jks`
- **Key Alias:** `mjautos`
- **Keystore Password:** `mjautos123`
- **Key Password:** `mjautos123`

To regenerate the keystore with custom details:
```cmd
scripts\generate-release-keystore.bat
```

---

## Google Play Store Publishing Steps

1. **Google Play Console:** Log in at [play.google.com/console](https://play.google.com/console).
2. **Create App:** Name: `MJ AUTOS`, Default language: `English`, App type: `App`, Free/Paid: `Free`.
3. **Upload App Bundle:** Navigate to **Production** (or **Internal Testing**) &rarr; **Create new release** &rarr; Upload `android/app/build/outputs/bundle/release/app-release.aab`.
4. **App Icons & Graphics:**
   - **App Icon (512x512):** Upload `android/app/playstore-icon-512.png`.
   - **Feature Graphic (1024x500):** Create a banner with the MJ AUTOS logo.
   - **Screenshots:** Capture screenshots on a phone or tablet.
5. **Review & Publish:** Complete the Content Rating and Data Safety forms, then submit for review.
