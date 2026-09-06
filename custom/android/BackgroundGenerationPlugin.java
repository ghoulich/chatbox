package xyz.chatboxapp.chatbox;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Starts and stops the bounded foreground service used by active model streams. */
@CapacitorPlugin(name = "BackgroundGeneration")
public class BackgroundGenerationPlugin extends Plugin {
    private static final int MIN_DURATION_MS = 60_000;
    private static final int MAX_DURATION_MS = 30 * 60_000;
    private static final long START_CONFIRMATION_TIMEOUT_MS = 5_000;
    private static final Map<String, PluginCall> pendingStarts = new ConcurrentHashMap<>();

    static void resolveStart(String taskId) {
        PluginCall call = pendingStarts.remove(taskId);
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("started", true);
        call.resolve(result);
    }

    static void rejectStart(String taskId, String message) {
        PluginCall call = pendingStarts.remove(taskId);
        if (call != null) call.reject(message);
    }

    private static void timeoutStart(String taskId) {
        rejectStart(taskId, "Android did not confirm the foreground service start");
    }

    @PluginMethod
    public void start(PluginCall call) {
        String taskId = call.getString("taskId");
        if (taskId == null || taskId.trim().isEmpty()) {
            call.reject("taskId is required");
            return;
        }
        int requestedDuration = call.getData().optInt("maxDurationMs", MAX_DURATION_MS);
        int duration = Math.max(MIN_DURATION_MS, Math.min(requestedDuration, MAX_DURATION_MS));
        Context context = getContext().getApplicationContext();
        Intent intent = BackgroundGenerationService.startIntent(context, taskId, duration);
        try {
            pendingStarts.put(taskId, call);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            // Initialize the Handler only when a generation actually starts. The
            // plugin class is loaded while MainActivity is starting, and should
            // not create Android runtime objects during class registration.
            new Handler(Looper.getMainLooper()).postDelayed(
                () -> timeoutStart(taskId),
                START_CONFIRMATION_TIMEOUT_MS
            );
        } catch (Exception error) {
            pendingStarts.remove(taskId);
            call.reject("Unable to start background generation", error);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        String taskId = call.getString("taskId");
        if (taskId == null || taskId.trim().isEmpty()) {
            call.reject("taskId is required");
            return;
        }
        try {
            rejectStart(taskId, "Background generation stopped before Android confirmed it");
            // The service lives in this process. If no instance exists, the task
            // is already stopped; never start a new background service merely to
            // deliver a stop command, which Android/OEM policy may reject.
            BackgroundGenerationService.stopTaskIfRunning(taskId);
            JSObject result = new JSObject();
            result.put("stopped", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Unable to stop background generation", error);
        }
    }

}
