package pk.mjautos.shop;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.graphics.Insets;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import java.io.File;
import java.io.IOException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

import pk.mjautos.shop.databinding.ActivityMainBinding;

public class MainActivity extends AppCompatActivity {

    private static final String PREFS_NAME = "MJAutosPrefs";
    private static final String KEY_SERVER_URL = "server_url";

    private ActivityMainBinding binding;
    private ValueCallback<Uri[]> fileUploadCallback;
    private Uri cameraImageUri;
    private boolean doubleBackToExitPressedOnce = false;
    private String currentServerUrl;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    private final ActivityResultLauncher<Intent> fileChooserLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(),
            result -> {
                if (fileUploadCallback == null) return;
                Uri[] results = null;
                if (result.getResultCode() == RESULT_OK) {
                    Intent data = result.getData();
                    if (data != null && data.getData() != null) {
                        results = new Uri[]{data.getData()};
                    } else if (cameraImageUri != null) {
                        results = new Uri[]{cameraImageUri};
                    }
                }
                fileUploadCallback.onReceiveValue(results);
                fileUploadCallback = null;
            }
    );

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);

        binding = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        setupSafeArea();
        loadServerUrl();
        setupWebView();
        setupSwipeRefresh();
        setupErrorHandling();
        setupBackNavigation();
        registerNetworkMonitoring();

        // Load the website
        loadWebsite(currentServerUrl);
    }

    private void setupSafeArea() {
        // Safe area insets: prevents status bar, notch, display cutouts, and bottom navigation bar from overlapping UI
        ViewCompat.setOnApplyWindowInsetsListener(binding.rootLayout, (v, windowInsets) -> {
            Insets insets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            v.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            return windowInsets;
        });
    }

    private void loadServerUrl() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        currentServerUrl = prefs.getString(KEY_SERVER_URL, getString(R.string.website_url));
    }

    private void saveServerUrl(String url) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }
        currentServerUrl = url.trim();
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .edit()
                .putString(KEY_SERVER_URL, currentServerUrl)
                .apply();
        loadWebsite(currentServerUrl);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = binding.webView.getSettings();

        // Core JavaScript & Storage
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // Viewport and responsiveness
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false); // Clean app look without zoom buttons

        // File access
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        // Modern compatibility & caching
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        // App User-Agent signature
        String customUA = settings.getUserAgentString() + " MJAutosApp/1.0.0 (Android)";
        settings.setUserAgentString(customUA);

        // Cookie synchronization for JWT / HttpOnly session persistence
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(binding.webView, true);

        // Inject Native Print Interface for thermal/A4 receipts
        binding.webView.addJavascriptInterface(new AndroidPrintInterface(), "AndroidPrint");

        // WebChromeClient for progress bar and file uploads
        binding.webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (newProgress < 100) {
                    binding.progressBar.setVisibility(View.VISIBLE);
                    binding.progressBar.setProgress(newProgress);
                } else {
                    binding.progressBar.setVisibility(View.GONE);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback,
                                             FileChooserParams fileChooserParams) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = filePathCallback;

                Intent takePictureIntent = null;
                try {
                    File photoFile = createImageFile();
                    if (photoFile != null) {
                        cameraImageUri = FileProvider.getUriForFile(MainActivity.this,
                                getPackageName() + ".fileprovider", photoFile);
                        takePictureIntent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        takePictureIntent.putExtra(MediaStore.EXTRA_OUTPUT, cameraImageUri);
                    }
                } catch (Exception e) {
                    cameraImageUri = null;
                }

                Intent contentSelectionIntent = fileChooserParams.createIntent();
                List<Intent> intentList = new ArrayList<>();
                if (takePictureIntent != null) {
                    intentList.add(takePictureIntent);
                }

                Intent chooserIntent = new Intent(Intent.ACTION_CHOOSER);
                chooserIntent.putExtra(Intent.EXTRA_INTENT, contentSelectionIntent);
                chooserIntent.putExtra(Intent.EXTRA_TITLE, "Select File or Photo");
                if (!intentList.isEmpty()) {
                    chooserIntent.putExtra(Intent.EXTRA_INITIAL_INTENTS, intentList.toArray(new Parcelable[0]));
                }

                fileChooserLauncher.launch(chooserIntent);
                return true;
            }
        });

        // WebViewClient for navigation, error handling and external URL routing
        binding.webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                return handleSpecialUrls(url);
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                binding.layoutError.setVisibility(View.GONE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                binding.swipeRefresh.setRefreshing(false);
                CookieManager.getInstance().flush();

                // Hook window.print() so receipt print buttons call the native Android print spooler
                String printHook = "javascript:(function() {" +
                        "if (!window.__nativePrintHooked) {" +
                        "  window.__nativePrintHooked = true;" +
                        "  var originalPrint = window.print;" +
                        "  window.print = function() {" +
                        "    if (window.AndroidPrint && window.AndroidPrint.printReceipt) {" +
                        "      window.AndroidPrint.printReceipt();" +
                        "    } else if (originalPrint) {" +
                        "      originalPrint();" +
                        "    }" +
                        "  };" +
                        "}" +
                        "})();";
                view.evaluateJavascript(printHook, null);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showErrorScreen();
                }
            }
        });

        // Download listener for CSV reports and bills
        binding.webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimetype, long contentLength) {
                try {
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                    request.setMimeType(mimetype);

                    String cookies = CookieManager.getInstance().getCookie(url);
                    if (cookies != null) {
                        request.addRequestHeader("cookie", cookies);
                    }
                    request.addRequestHeader("User-Agent", userAgent);

                    String fileName = URLUtil.guessFileName(url, contentDisposition, mimetype);
                    request.setDescription(getString(R.string.downloading_file));
                    request.setTitle(fileName);
                    request.allowScanningByMediaScanner();
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);

                    DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                    if (dm != null) {
                        dm.enqueue(request);
                        Toast.makeText(MainActivity.this, getString(R.string.downloading_file) + ": " + fileName, Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Download failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private boolean handleSpecialUrls(String url) {
        if (url == null) return false;

        // Dial phone number
        if (url.startsWith("tel:")) {
            Intent intent = new Intent(Intent.ACTION_DIAL, Uri.parse(url));
            startActivity(intent);
            return true;
        }

        // Email link
        if (url.startsWith("mailto:")) {
            Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse(url));
            startActivity(intent);
            return true;
        }

        // WhatsApp, SMS, or intent links
        if (url.startsWith("whatsapp:") || url.contains("api.callmebot.com") || url.startsWith("smsto:") || url.startsWith("sms:")) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(intent);
            } catch (ActivityNotFoundException e) {
                Toast.makeText(this, "Application not installed to handle this action", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        // Check if URL belongs to our app domain
        Uri uri = Uri.parse(url);
        Uri baseUri = Uri.parse(currentServerUrl);
        if (uri.getHost() != null && baseUri.getHost() != null) {
            if (uri.getHost().equalsIgnoreCase(baseUri.getHost()) || uri.getHost().endsWith("." + baseUri.getHost())) {
                return false; // Stay inside WebView
            }
        }

        // Open other external URLs in device browser
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void setupSwipeRefresh() {
        binding.swipeRefresh.setColorSchemeColors(ContextCompat.getColor(this, R.color.brand_primary));
        binding.swipeRefresh.setProgressBackgroundColorSchemeColor(ContextCompat.getColor(this, R.color.app_dark_bg));

        // Pull to refresh reloads current page
        binding.swipeRefresh.setOnRefreshListener(() -> {
            if (isNetworkAvailable()) {
                binding.webView.reload();
            } else {
                binding.swipeRefresh.setRefreshing(false);
                showErrorScreen();
            }
        });

        // Prevent pull-to-refresh when scrolled down inside webpage
        binding.webView.getViewTreeObserver().addOnScrollChangedListener(() -> {
            binding.swipeRefresh.setEnabled(binding.webView.getScrollY() == 0);
        });
    }

    private void setupErrorHandling() {
        binding.btnRetry.setOnClickListener(v -> {
            if (isNetworkAvailable()) {
                binding.layoutError.setVisibility(View.GONE);
                loadWebsite(currentServerUrl);
            } else {
                Toast.makeText(this, R.string.error_no_internet_title, Toast.LENGTH_SHORT).show();
            }
        });

        binding.btnChangeServer.setOnClickListener(v -> showServerUrlDialog());
    }

    private void showServerUrlDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle(R.string.dialog_set_url_title);
        builder.setMessage(R.string.dialog_set_url_msg);

        final EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setText(currentServerUrl);
        input.setSelection(currentServerUrl.length());
        builder.setView(input);

        builder.setPositiveButton("Save & Reload", (dialog, which) -> {
            String newUrl = input.getText().toString().trim();
            if (!newUrl.isEmpty()) {
                saveServerUrl(newUrl);
            }
        });
        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());
        builder.show();
    }

    private void setupBackNavigation() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (binding.layoutError.getVisibility() == View.VISIBLE) {
                    finish();
                    return;
                }

                if (binding.webView.canGoBack()) {
                    binding.webView.goBack();
                } else {
                    if (doubleBackToExitPressedOnce) {
                        finish();
                        return;
                    }

                    doubleBackToExitPressedOnce = true;
                    Toast.makeText(MainActivity.this, R.string.press_again_to_exit, Toast.LENGTH_SHORT).show();

                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        doubleBackToExitPressedOnce = false;
                    }, 2000);
                }
            }
        });
    }

    private void loadWebsite(String url) {
        if (!isNetworkAvailable()) {
            showErrorScreen();
            return;
        }
        binding.layoutError.setVisibility(View.GONE);
        binding.webView.loadUrl(url);
    }

    private void showErrorScreen() {
        binding.swipeRefresh.setRefreshing(false);
        binding.progressBar.setVisibility(View.GONE);
        binding.layoutError.setVisibility(View.VISIBLE);
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return false;
        Network network = cm.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities capabilities = cm.getNetworkCapabilities(network);
        return capabilities != null && (
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ||
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
    }

    private void registerNetworkMonitoring() {
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) return;

        NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();

        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(@NonNull Network network) {
                runOnUiThread(() -> {
                    if (binding.layoutError.getVisibility() == View.VISIBLE) {
                        binding.layoutError.setVisibility(View.GONE);
                        binding.webView.reload();
                    }
                });
            }
        };

        try {
            connectivityManager.registerNetworkCallback(request, networkCallback);
        } catch (Exception ignored) {}
    }

    private File createImageFile() throws IOException {
        String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(new Date());
        String imageFileName = "MJ_JPEG_" + timeStamp + "_";
        File storageDir = getExternalFilesDir(Environment.DIRECTORY_PICTURES);
        return File.createTempFile(imageFileName, ".jpg", storageDir);
    }

    @Override
    protected void onResume() {
        super.onResume();
        binding.webView.onResume();
    }

    @Override
    protected void onPause() {
        super.onPause();
        binding.webView.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {}
        }
        if (binding.webView != null) {
            binding.webView.destroy();
        }
    }

    /**
     * JavaScript Interface that handles window.print() natively
     * for printing A4 and 80mm thermal receipts via Android PrintManager.
     */
    public class AndroidPrintInterface {
        @JavascriptInterface
        public void printReceipt() {
            runOnUiThread(() -> {
                try {
                    PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    if (printManager != null) {
                        String jobName = getString(R.string.app_name) + "_Receipt_" + System.currentTimeMillis();
                        PrintDocumentAdapter printAdapter = binding.webView.createPrintDocumentAdapter(jobName);
                        PrintAttributes.Builder builder = new PrintAttributes.Builder();
                        builder.setColorMode(PrintAttributes.COLOR_MODE_MONOCHROME);
                        printManager.print(jobName, printAdapter, builder.build());
                    }
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Printing error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });
        }
    }
}
