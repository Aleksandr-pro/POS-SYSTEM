package kz.poskontrol.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.webkit.MimeTypeMap;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Раздаёт файлы из приватного каталога приложения (экспорт Excel, резервные копии),
 * чтобы их можно было открыть и отправить через «Поделиться» на любой версии Android.
 */
public class FileShareProvider extends ContentProvider {

    public static final String AUTHORITY = "kz.poskontrol.app.files";
    public static final String PATH = "exports";

    public static File baseDir(Context context) {
        File dir = null;
        try {
            File external = context.getExternalFilesDir(null);
            if (external != null) dir = new File(external, PATH);
        } catch (Exception ignored) { }
        if (dir == null) dir = new File(context.getFilesDir(), PATH);
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    public static Uri uriFor(Context context, String fileName) {
        return new Uri.Builder()
                .scheme("content")
                .authority(AUTHORITY)
                .appendPath(fileName)
                .build();
    }

    @Override
    public boolean onCreate() {
        if (getContext() != null) baseDir(getContext());
        return true;
    }

    private File resolve(Uri uri) {
        String name = uri.getLastPathSegment();
        if (name == null) return null;
        name = name.replace("/", "_").replace("\\", "_");
        return new File(baseDir(getContext()), name);
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File file = resolve(uri);
        if (file == null) throw new FileNotFoundException("Файл не найден: " + uri);
        boolean write = mode != null && (mode.contains("w") || mode.contains("wt")
                || mode.contains("wa") || mode.contains("rw") || mode.contains("rwt"));
        if (write) {
            // камера пишет снимок сюда — файл создаём сами и открываем на запись
            try {
                File dir = file.getParentFile();
                if (dir != null && !dir.exists()) dir.mkdirs();
                if (!file.exists()) file.createNewFile();
            } catch (Exception e) {
                throw new FileNotFoundException("Не удалось создать файл: " + uri);
            }
            return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
        }
        if (!file.exists()) throw new FileNotFoundException("Файл не найден: " + uri);
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File file = resolve(uri);
        if (file == null) return null;
        String[] cols = projection != null ? projection
                : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cursor = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = file.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = file.length();
            else row[i] = null;
        }
        cursor.addRow(row);
        return cursor;
    }

    @Override
    public String getType(Uri uri) {
        File file = resolve(uri);
        if (file == null) return "application/octet-stream";
        String name = file.getName();
        int dot = name.lastIndexOf('.');
        if (dot == -1) return "application/octet-stream";
        String ext = name.substring(dot + 1).toLowerCase();
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return mime != null ? mime : "application/octet-stream";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("Только чтение");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
