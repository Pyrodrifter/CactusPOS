package com.cactuspos.client;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintManager;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;
    private LinearLayout root, content;
    private WebView web, printWeb;
    private TextView title, message;
    private String origin = "http://cactus.local";
    private int screen = 0, connectionAttempt = 0;
    private boolean showingSettings = true;
    private NsdManager nsd;
    private NsdManager.DiscoveryListener discovery;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (android.os.Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences("connection", MODE_PRIVATE);
        origin = prefs.getString("origin", "http://cactus.local");
        screen = prefs.getInt("screen", 0);
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(Color.WHITE);
        // Respect system bars on edge-to-edge Android versions, including display cutouts.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        LinearLayout bar = new LinearLayout(this); bar.setGravity(Gravity.CENTER_VERTICAL); bar.setBackgroundColor(Color.rgb(15, 29, 74));
        title = text("CactusPOS", 19); title.setTextColor(Color.WHITE); title.setPadding(dp(16), 0, 0, 0);
        bar.addView(title, new LinearLayout.LayoutParams(0, dp(56), 1));
        Button settings = button("Connection", () -> {
            if (web != null && !showingSettings) new AlertDialog.Builder(this).setTitle("Change connection?").setMessage("Finish any payment before changing the server or screen.").setNegativeButton("Keep working", null).setPositiveButton("Connection", (dialog, which) -> showSettings()).show();
            else showSettings();
        });
        bar.addView(settings, new LinearLayout.LayoutParams(dp(120), dp(52))); root.addView(bar);
        content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1)); setContentView(root);
        showSettings();
        if (prefs.getBoolean("configured", false)) connect(origin, screen);
    }

    private int dp(int size) { return Math.round(size * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size) { TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setGravity(Gravity.CENTER_VERTICAL); return view; }
    private Button button(String label, Runnable action) { Button view = new Button(this); view.setText(label); view.setMinHeight(dp(52)); view.setOnClickListener(v -> action.run()); return view; }
    private void showSettings() {
        connectionAttempt++; stopDiscovery(); showingSettings = true;
        if (web != null) { content.removeView(web); web.setVisibility(View.GONE); }
        content.removeAllViews(); content.setPadding(dp(20), dp(12), dp(20), dp(12)); title.setText("CactusPOS · Connection");
        ScrollView scroll = new ScrollView(this); scroll.setFillViewport(true);
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); scroll.addView(form);
        content.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
        form.addView(text("Connect to your till", 24));
        form.addView(text("Connect this device to the same WiFi as the Surface. The Surface must stay on.", 16));
        form.addView(text("Till address", 16));
        EditText address = new EditText(this); address.setSingleLine(true); address.setSelectAllOnFocus(true); address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(origin); address.setMinHeight(dp(56)); address.setContentDescription("Till address"); form.addView(address);
        form.addView(button("Find a till on this WiFi", () -> discover(address)));
        form.addView(text("Screen on this device", 16));
        Spinner roles = new Spinner(this); roles.setContentDescription("Screen on this device");
        roles.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[] { "Till / taking orders", "Kitchen", "Pickup board", "Admin" }));
        roles.setSelection(screen); form.addView(roles, new LinearLayout.LayoutParams(-1, dp(56)));
        message = text("Use cactus.local, or the IP address shown on the Surface under Connect a tablet or phone.", 16); form.addView(message);
        form.addView(button("Connect", () -> {
            try { connect(ServerAddress.normalize(address.getText().toString()), roles.getSelectedItemPosition()); }
            catch (IllegalArgumentException error) { message.setText("Use an address such as cactus.local or 192.168.1.20:3000."); }
        }));
        if (web != null) form.addView(button("Back to current screen", this::showWeb));
    }

    private void connect(String candidate, int chosenScreen) {
        final int attempt = ++connectionAttempt;
        if (message != null) message.setText("Checking the till…");
        worker.execute(() -> {
            String failure = null;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(candidate + "/api/health").openConnection();
                connection.setConnectTimeout(7000); connection.setReadTimeout(7000); connection.setInstanceFollowRedirects(false);
                if (connection.getResponseCode() != 200) throw new Exception("The address did not answer as a CactusPOS till.");
                ByteArrayOutputStream data = new ByteArrayOutputStream();
                try (InputStream input = connection.getInputStream()) {
                    byte[] buffer = new byte[2048]; int size;
                    while ((size = input.read(buffer)) != -1) { if (data.size() + size > 16_384) throw new Exception("Unexpected response"); data.write(buffer, 0, size); }
                }
                JSONObject health = new JSONObject(new String(data.toByteArray(), StandardCharsets.UTF_8));
                if (!health.optBoolean("ok") || !health.optString("app").equals("cactuspos")) throw new Exception("This address is not a CactusPOS till.");
            } catch (Exception error) { failure = "Cannot reach the till. Check the WiFi and that the Surface is on. If cactus.local fails, use the IP address from the Surface."; }
            finally { if (connection != null) connection.disconnect(); }
            final String problem = failure;
            main.post(() -> {
                if (isFinishing() || isDestroyed() || attempt != connectionAttempt) return;
                if (problem != null) { if (!showingSettings || message == null) showSettings(); message.setText(problem); return; }
                stopDiscovery();
                boolean serverChanged = !candidate.equals(origin);
                boolean changed = serverChanged || chosenScreen != screen;
                origin = candidate; screen = chosenScreen;
                prefs.edit().putString("origin", origin).putInt("screen", screen).putBoolean("configured", true).apply();
                if (serverChanged) prefs.edit().putBoolean("practice", false).apply();
                if (web == null || changed) { destroyWeb(); createWeb(); web.loadUrl(origin + (prefs.getBoolean("practice", false) ? "/practice" : "") + ServerAddress.screenPath(screen)); }
                showWeb();
            });
        });
    }

    private void showWeb() {
        showingSettings = false; content.removeAllViews(); content.setPadding(0, 0, 0, 0);
        if (web != null) { web.setVisibility(View.VISIBLE); content.addView(web, new LinearLayout.LayoutParams(-1, -1)); }
        updateTitle();
    }

    private void updateTitle() {
        title.setText(prefs.getBoolean("practice", false) ? "CactusPOS · PRACTICE" :
                "CactusPOS · " + new String[] { "Till", "Kitchen", "Pickup", "Admin" }[Math.max(0, Math.min(3, screen))]);
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"}) private void createWeb() {
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web = new WebView(this); web.setContentDescription("CactusPOS screen");
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.addJavascriptInterface(new PrintBridge(), "CactusAndroid");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (ServerAddress.sameOrigin(url, origin)) return false;
                if (request.isForMainFrame() && request.hasGesture() && (url.startsWith("https://") || url.startsWith("http://"))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) { }
                }
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (ServerAddress.sameOrigin(url, origin) || url.startsWith("data:") || url.startsWith("blob:") || url.equals("about:blank")) return null;
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!ServerAddress.sameOrigin(url, origin)) return;
                boolean practice = Uri.parse(url).getPath() != null && Uri.parse(url).getPath().startsWith("/practice/");
                prefs.edit().putBoolean("practice", practice).apply();
                updateTitle();
                view.evaluateJavascript("""
                    (() => {
                      const attach = f => { try { f.contentWindow.print = () => CactusAndroid.printHtml(f.contentDocument.documentElement.outerHTML); } catch (_) {} };
                      window.print = () => CactusAndroid.printHtml(document.documentElement.outerHTML);
                      const watch = f => { if (f.dataset.cactusNativePrint) return; f.dataset.cactusNativePrint = '1'; f.addEventListener('load', () => attach(f)); attach(f); };
                      document.querySelectorAll('iframe').forEach(watch);
                      new MutationObserver(() => document.querySelectorAll('iframe').forEach(watch)).observe(document.documentElement, { childList: true, subtree: true });
                    })();
                    """, null);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !showingSettings) {
                    content.removeAllViews(); content.setPadding(dp(20), dp(20), dp(20), dp(20));
                    content.addView(text("The till connection was interrupted", 22));
                    content.addView(text("Check the WiFi and Surface. Check Orders before retrying a payment whose result you did not see.", 16));
                    content.addView(button("Reconnect", () -> { showWeb(); web.loadUrl(origin + (prefs.getBoolean("practice", false) ? "/practice" : "") + ServerAddress.screenPath(screen)); }));
                    content.addView(button("Connection settings", () -> showSettings()));
                }
            }
        });
    }

    private class PrintBridge {
        @JavascriptInterface public boolean supportsPracticeMode() { return true; }
        @JavascriptInterface public void printHtml(String html) {
            if (html == null || html.length() > 2_000_000) return;
            main.post(() -> {
                if (web == null || !ServerAddress.sameOrigin(web.getUrl(), origin) || isFinishing()) return;
                if (printWeb != null) printWeb.destroy();
                printWeb = new WebView(MainActivity.this); printWeb.getSettings().setJavaScriptEnabled(false);
                printWeb.getSettings().setAllowFileAccess(false); printWeb.getSettings().setAllowContentAccess(false); printWeb.getSettings().setBlockNetworkLoads(true);
                printWeb.setWebViewClient(new WebViewClient() {
                    @Override public void onPageFinished(WebView view, String url) {
                        PrintManager printer = (PrintManager) getSystemService(PRINT_SERVICE);
                        printer.print("CactusPOS receipt", view.createPrintDocumentAdapter("CactusPOS receipt"), null);
                    }
                });
                printWeb.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            });
        }
    }

    @SuppressWarnings("deprecation") private void discover(EditText address) {
        stopDiscovery(); message.setText("Looking for a CactusPOS till on this WiFi…");
        nsd = (NsdManager) getSystemService(NSD_SERVICE);
        discovery = new NsdManager.DiscoveryListener() {
            public void onDiscoveryStarted(String type) { }
            public void onDiscoveryStopped(String type) { }
            public void onServiceLost(NsdServiceInfo info) { }
            public void onStartDiscoveryFailed(String type, int error) { main.post(() -> message.setText("Discovery is unavailable. Enter cactus.local or the Surface IP address.")); }
            public void onStopDiscoveryFailed(String type, int error) { }
            public void onServiceFound(NsdServiceInfo info) {
                nsd.resolveService(info, new NsdManager.ResolveListener() {
                    public void onResolveFailed(NsdServiceInfo service, int error) { }
                    public void onServiceResolved(NsdServiceInfo service) {
                        if (service.getHost() == null) return;
                        String ip = service.getHost().getHostAddress();
                        String value = "http://" + (ip.contains(":") ? "[" + ip + "]" : ip) + (service.getPort() == 80 ? "" : ":" + service.getPort());
                        main.post(() -> { if (showingSettings) { address.setText(value); message.setText("Till found. Choose a screen and tap Connect."); } stopDiscovery(); });
                    }
                });
            }
        };
        try { nsd.discoverServices("_cactuspos._tcp.", NsdManager.PROTOCOL_DNS_SD, discovery); }
        catch (Exception error) { message.setText("Discovery is unavailable. Enter cactus.local or the Surface IP address."); }
        final NsdManager.DiscoveryListener current = discovery;
        main.postDelayed(() -> { if (discovery == current) { stopDiscovery(); if (showingSettings) message.setText("No till found yet. Use cactus.local or the IP address shown on the Surface."); } }, 10_000);
    }
    private void stopDiscovery() { if (nsd != null && discovery != null) { try { nsd.stopServiceDiscovery(discovery); } catch (Exception ignored) { } discovery = null; } }
    private void destroyWeb() { if (web != null) { content.removeView(web); web.removeJavascriptInterface("CactusAndroid"); web.destroy(); web = null; } }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
    @Override protected void onDestroy() { connectionAttempt++; stopDiscovery(); worker.shutdownNow(); destroyWeb(); if (printWeb != null) printWeb.destroy(); super.onDestroy(); }
    private void handleBack() { if (showingSettings && web != null) showWeb(); else if (web != null && web.canGoBack()) web.goBack(); else new AlertDialog.Builder(this).setMessage("Close CactusPOS on this device?").setNegativeButton("Keep working", null).setPositiveButton("Close", (dialog, which) -> finish()).show(); }
    // API 33+ uses the platform dispatcher registered above; older devices call this method.
    @SuppressLint("GestureBackNavigation") @Override public void onBackPressed() { handleBack(); }
}
