package kz.poskontrol.app;

import android.annotation.SuppressLint;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * POS Контроль — нативная оболочка.
 * Веб-часть лежит в assets/www, приложение работает полностью офлайн.
 */
public class MainActivity extends android.app.Activity {

    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_CAMERA = 1002;
    private static final int REQ_LOCATION = 2002;
    private static final int REQ_CAMERA_PERMISSION = 3003;

    private static final String START_URL = "file:///android_asset/www/index.html";
    private static final String COLOR_LIGHT = "#f4f5fa";
    private static final String COLOR_DARK = "#0a0e18";

    private WebView webView;
    private FrameLayout root;
    private ImageView splash;
    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraOutputUri;
    private boolean pendingCameraAction = false;
    private boolean darkTheme = false;
    private boolean firstLoadDone = false;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = window.getAttributes();
            attrs.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            window.setAttributes(attrs);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor(COLOR_LIGHT));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor(COLOR_LIGHT));
        webView.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setGeolocationEnabled(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false);
        }

        webView.addJavascriptInterface(new AndroidPos(), "AndroidPos");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.evaluateJavascript(
                        "(function(){try{return document.documentElement.getAttribute('data-theme')||'light';}catch(e){return 'light';}})()",
                        value -> applyThemeFromWeb(value));
                if (!firstLoadDone) {
                    firstLoadDone = true;
                    hideSplash();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                boolean wantCamera = false;
                try {
                    wantCamera = params != null && params.isCaptureEnabled();
                    if (!wantCamera && params != null && params.getAcceptTypes() != null) {
                        for (String type : params.getAcceptTypes()) {
                            if (type != null && type.toLowerCase(Locale.US).contains("image/*")) break;
                        }
                    }
                } catch (Exception ignored) { }
                if (wantCamera) openCamera();
                else showPicker();
                return true;
            }
        });

        root.addView(webView);

        // Заставка, пока грузится интерфейс
        splash = new ImageView(this);
        splash.setImageResource(R.mipmap.ic_launcher);
        int size = (int) (getResources().getDisplayMetrics().density * 96);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(size, size);
        lp.gravity = android.view.Gravity.CENTER;
        splash.setLayoutParams(lp);
        root.addView(splash);

        setContentView(root);

        applyEdgeInsets();
        requestLocationPermissionIfNeeded();

        if (savedInstanceState == null) {
            webView.loadUrl(START_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    /* ---------------- URL ---------------- */

    private boolean handleUrl(Uri uri) {
        if (uri == null) return false;
        String scheme = uri.getScheme() == null ? "" : uri.getScheme();
        if (scheme.equals("file") || scheme.equals("about") || scheme.equals("data") || scheme.equals("blob")) {
            return false; // грузим внутри приложения
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Не найдено приложение для этой ссылки", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    /* ---------------- Выбор файла / камера ---------------- */

    /** Готовит пустой файл и content:// ссылку, куда камера запишет снимок. */
    private Uri prepareCameraTarget() {
        try {
            File dir = FileShareProvider.baseDir(this);
            String stamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
            File photo = new File(dir, "photo_" + stamp + ".jpg");
            if (!photo.exists()) photo.createNewFile();
            Uri uri = FileShareProvider.uriFor(this, photo.getName());
            grantCameraWrite(uri);
            return uri;
        } catch (Exception e) {
            return null;
        }
    }

    /** Выдаёт камере право записи в наш файл (нужно на Android 5+). */
    private void grantCameraWrite(Uri uri) {
        if (uri == null) return;
        Intent probe = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        java.util.List<android.content.pm.ResolveInfo> targets =
                getPackageManager().queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY);
        for (android.content.pm.ResolveInfo info : targets) {
            String pkg = info.activityInfo == null ? null : info.activityInfo.packageName;
            if (pkg == null) continue;
            try {
                grantUriPermission(pkg, uri,
                        Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) { }
        }
    }

    /** Прямая съёмка на камеру (запрос из input capture="environment"). */
    private void openCamera() {
        if (checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            pendingCameraAction = true;
            requestPermissions(new String[]{android.Manifest.permission.CAMERA}, REQ_CAMERA_PERMISSION);
            return;
        }
        launchCamera();
    }

    private void launchCamera() {
        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        Uri target = prepareCameraTarget();
        if (target != null) {
            cameraOutputUri = target;
            camera.putExtra(MediaStore.EXTRA_OUTPUT, target);
        }
        camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        if (camera.resolveActivity(getPackageManager()) == null) {
            pendingCameraAction = false;
            cameraOutputUri = null;
            Toast.makeText(this, "Камера недоступна — выберите фото из галереи", Toast.LENGTH_SHORT).show();
            showPicker();
            return;
        }
        try {
            startActivityForResult(camera, REQ_CAMERA);
        } catch (Exception e) {
            cameraOutputUri = null;
            Toast.makeText(this, "Не удалось открыть камеру", Toast.LENGTH_SHORT).show();
            showPicker();
        }
    }

    private void showPicker() {
        Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
        gallery.addCategory(Intent.CATEGORY_OPENABLE);
        gallery.setType("image/*");

        Intent chooser = Intent.createChooser(gallery, "Фото чека или товара");
        try {
            // Камера как дополнительный вариант в системном выборе
            Uri target = prepareCameraTarget();
            if (target != null) {
                cameraOutputUri = target;
                Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                camera.putExtra(MediaStore.EXTRA_OUTPUT, target);
                camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
            } else {
                cameraOutputUri = null;
            }
        } catch (Exception ignored) {
            cameraOutputUri = null;
        }

        try {
            startActivityForResult(chooser, REQ_FILE_CHOOSER);
        } catch (Exception e) {
            fileCallback = null;
            Toast.makeText(this, "Не удалось открыть выбор файла", Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER || requestCode == REQ_CAMERA) {
            if (fileCallback != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK) {
                    if (data != null && data.getClipData() != null) {
                        int count = data.getClipData().getItemCount();
                        result = new Uri[count];
                        for (int i = 0; i < count; i++) {
                            result[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data != null && data.getData() != null) {
                        result = new Uri[]{data.getData()};
                    } else if (cameraOutputUri != null && fileHasContent(cameraOutputUri)) {
                        // камера вернула результат без data, но снимок записан
                        result = new Uri[]{cameraOutputUri};
                    }
                }
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
            cameraOutputUri = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /** Проверяет, что по content:// действительно есть записанный файл. */
    private boolean fileHasContent(Uri uri) {
        try {
            File file = new File(FileShareProvider.baseDir(this), uri.getLastPathSegment());
            return file.exists() && file.length() > 0;
        } catch (Exception e) {
            return false;
        }
    }

    /* ---------------- JS-мост ---------------- */

    private class AndroidPos {
        @JavascriptInterface
        public void setTheme(String theme) {
            runOnUiThread(() -> {
                darkTheme = "dark".equals(theme);
                syncBarColors();
            });
        }

        @JavascriptInterface
        public String getVersion() {
            return "2.0.0";
        }

        @JavascriptInterface
        public void toast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this,
                    message == null ? "" : message, Toast.LENGTH_SHORT).show());
        }

        /**
         * Сохраняет файл (Excel-отчёт, резервную копию) и открывает системное меню «Поделиться».
         * Вызывается из xlsx.js: AndroidPos.exportFile(name, base64, mime)
         */
        @JavascriptInterface
        public boolean exportFile(String fileName, String base64, String mime) {
            try {
                String safeName = (fileName == null || fileName.isEmpty()) ? "file" : fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                File dir = FileShareProvider.baseDir(MainActivity.this);
                File file = new File(dir, safeName);
                FileOutputStream out = new FileOutputStream(file);
                out.write(bytes);
                out.close();

                Uri uri = FileShareProvider.uriFor(MainActivity.this, file.getName());
                final String finalMime = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "Файл сохранён: " + file.getName(), Toast.LENGTH_LONG).show();
                    try {
                        Intent share = new Intent(Intent.ACTION_SEND);
                        share.setType(finalMime);
                        share.putExtra(Intent.EXTRA_STREAM, uri);
                        share.putExtra(Intent.EXTRA_SUBJECT, file.getName());
                        share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(share, "Отправить файл"));
                    } catch (Exception e) {
                        try {
                            Intent view = new Intent(Intent.ACTION_VIEW);
                            view.setDataAndType(uri, finalMime);
                            view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            startActivity(Intent.createChooser(view, "Открыть файл"));
                        } catch (Exception ignored) { }
                    }
                });
                return true;
            } catch (Exception e) {
                final String message = e.getMessage();
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "Не удалось сохранить файл: " + message, Toast.LENGTH_LONG).show());
                return false;
            }
        }
    }

    /* ---------------- Оформление системных панелей ---------------- */

    private void applyEdgeInsets() {
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top = 0, bottom = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                top = bars.top;
                bottom = bars.bottom;
            } else {
                top = insets.getSystemWindowInsetTop();
                bottom = insets.getSystemWindowInsetBottom();
            }
            webView.setPadding(0, top, 0, bottom);
            if (splash != null) splash.setPadding(0, top, 0, bottom);
            syncBarColors();
            return insets;
        });
        root.requestApplyInsets();
    }

    private void applyThemeFromWeb(String value) {
        boolean dark = value != null && value.toLowerCase(Locale.US).contains("dark");
        if (dark == darkTheme) return;
        darkTheme = dark;
        syncBarColors();
    }

    private void syncBarColors() {
        int bg = Color.parseColor(darkTheme ? COLOR_DARK : COLOR_LIGHT);
        root.setBackgroundColor(bg);
        webView.setBackgroundColor(bg);
        if (splash != null) splash.setBackgroundColor(bg);

        Window window = getWindow();
        window.setStatusBarColor(bg);
        window.setNavigationBarColor(bg);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(darkTheme ? 0 : mask, mask);
            }
        } else {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE;
            if (!darkTheme) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                }
            }
            window.getDecorView().setSystemUiVisibility(flags);
        }
    }

    private void hideSplash() {
        if (splash == null) return;
        final ImageView view = splash;
        view.animate().alpha(0f).setDuration(220).withEndAction(() -> {
            if (view.getParent() != null) root.removeView(view);
            splash = null;
        }).start();
    }

    /* ---------------- Разрешения ---------------- */

    private void requestLocationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{
                        android.Manifest.permission.ACCESS_FINE_LOCATION,
                        android.Manifest.permission.ACCESS_COARSE_LOCATION
                }, REQ_LOCATION);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA_PERMISSION) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                pendingCameraAction = false;
                launchCamera();
            } else if (pendingCameraAction) {
                pendingCameraAction = false;
                Toast.makeText(this, "Нет доступа к камере — открываем галерею", Toast.LENGTH_SHORT).show();
                showPicker();
            }
            return;
        }
        if (requestCode == REQ_LOCATION && grantResults.length > 0
                && grantResults[0] != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, "Без геолокации отметки времени сохранятся без геометки", Toast.LENGTH_LONG).show();
        }
    }

    /* ---------------- Системная кнопка «Назад» ---------------- */

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript(
                "(function(){try{" +
                        "var m=document.querySelector('.modal-overlay');" +
                        "if(m){var b=m.querySelector('[data-close]');if(b){b.click();return 'closed';}m.remove();return 'removed';}" +
                        "var h=location.hash||'';" +
                        "if(h && h!=='#/dashboard' && h!=='#/cash'){history.back();return 'back';}" +
                        "return 'exit';" +
                        "}catch(e){return 'exit';}})()",
                value -> {
                    String v = value == null ? "" : value;
                    if (v.contains("exit")) finish();
                });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (webView != null) webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidPos");
            webView.destroy();
        }
        super.onDestroy();
    }
}
