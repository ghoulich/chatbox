package xyz.chatboxapp.chatbox;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Native bridge for exports and read-only mobile Skills. */
@CapacitorPlugin(name = "DocumentSaver")
public class DocumentSaverPlugin extends Plugin {
    private static final int MAX_SKILL_FILES = 200;
    private static final int MAX_SCAN_DEPTH = 12;
    private static final int MAX_SKILL_BYTES = 1024 * 1024;

    @PluginMethod
    public void selectSkillDirectory(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "selectSkillDirectoryResult");
    }

    @ActivityCallback
    private void selectSkillDirectoryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Directory selection canceled", "DIRECTORY_CANCELED");
            return;
        }
        Uri uri = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            JSObject response = new JSObject();
            response.put("uri", uri.toString());
            String name = getDocumentName(getContext().getContentResolver(), uri);
            if (name != null) response.put("name", name);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to retain directory access", error);
        }
    }

    @PluginMethod
    public void scanSkillDirectory(PluginCall call) {
        String rawUri = call.getString("uri");
        if (rawUri == null || rawUri.isEmpty()) { call.reject("uri is required"); return; }
        try {
            Uri treeUri = Uri.parse(rawUri);
            JSArray files = new JSArray();
            int[] count = new int[] { 0 };
            boolean[] truncated = new boolean[] { false };
            scanChildren(getContext().getContentResolver(), treeUri, DocumentsContract.getTreeDocumentId(treeUri),
                "", 0, files, count, truncated);
            JSObject response = new JSObject();
            response.put("files", files);
            response.put("truncated", truncated[0]);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Unable to scan Skills directory", error);
        }
    }

    private void scanChildren(ContentResolver resolver, Uri treeUri, String parentId, String relativePath,
                              int depth, JSArray files, int[] count, boolean[] truncated) throws Exception {
        if (depth > MAX_SCAN_DEPTH || count[0] >= MAX_SKILL_FILES) { truncated[0] = true; return; }
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId);
        String[] projection = new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE };
        Cursor cursor = resolver.query(childrenUri, projection, null, null, null);
        if (cursor == null) return;
        try {
            while (cursor.moveToNext()) {
                if (count[0] >= MAX_SKILL_FILES) { truncated[0] = true; break; }
                String id = cursor.getString(0);
                String name = cursor.getString(1);
                String mimeType = cursor.getString(2);
                String path = relativePath.isEmpty() ? name : relativePath + "/" + name;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                    scanChildren(resolver, treeUri, id, path, depth + 1, files, count, truncated);
                } else if ("SKILL.md".equalsIgnoreCase(name)) {
                    Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
                    JSObject file = new JSObject();
                    file.put("path", path);
                    file.put("content", readUtf8(resolver, documentUri));
                    files.put(file);
                    count[0]++;
                }
            }
        } finally { cursor.close(); }
    }

    private String readUtf8(ContentResolver resolver, Uri uri) throws IOException {
        InputStream input = resolver.openInputStream(uri);
        if (input == null) throw new IOException("Cannot open " + uri);
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_SKILL_BYTES) throw new IOException("SKILL.md exceeds 1 MiB");
                output.write(buffer, 0, read);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        } finally { input.close(); }
    }

    private String getDocumentName(ContentResolver resolver, Uri treeUri) {
        Cursor cursor = null;
        try {
            String id = DocumentsContract.getTreeDocumentId(treeUri);
            Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, id);
            cursor = resolver.query(documentUri,
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null);
            return cursor != null && cursor.moveToFirst() ? cursor.getString(0) : null;
        } catch (Exception ignored) { return null; }
        finally { if (cursor != null) cursor.close(); }
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        String sourceUri = call.getString("sourceUri");
        String suggestedName = call.getString("suggestedName");
        String mimeType = call.getString("mimeType");
        if (sourceUri == null || sourceUri.isEmpty()) { call.reject("sourceUri is required"); return; }
        if (suggestedName == null || suggestedName.isEmpty()) { call.reject("suggestedName is required"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType == null || mimeType.isEmpty() ? "*/*" : mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, suggestedName);
        call.getData().put("sourceUri", sourceUri);
        startActivityForResult(call, intent, "saveFileResult");
    }

    @ActivityCallback
    private void saveFileResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Save canceled", "SAVE_CANCELED"); return;
        }
        Uri target = result.getData().getData();
        try {
            copyUriToTarget(call.getString("sourceUri"), target);
            JSObject response = new JSObject(); response.put("uri", target.toString()); call.resolve(response);
        } catch (Exception error) {
            try { getContext().getContentResolver().delete(target, null, null); } catch (Exception ignored) {}
            call.reject("Failed to save file", error);
        }
    }

    private void copyUriToTarget(String source, Uri target) throws IOException {
        InputStream input = openSourceInputStream(source);
        OutputStream output = getContext().getContentResolver().openOutputStream(target, "w");
        if (input == null || output == null) throw new IOException("Cannot open stream");
        try {
            byte[] buffer = new byte[8192]; int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            output.flush();
        } finally { try { input.close(); } finally { output.close(); } }
    }

    private InputStream openSourceInputStream(String source) throws IOException {
        Uri uri = Uri.parse(source);
        if ("content".equalsIgnoreCase(uri.getScheme())) return getContext().getContentResolver().openInputStream(uri);
        String path = uri.getPath();
        return new FileInputStream(new File(path == null || path.isEmpty() ? source : path));
    }
}
