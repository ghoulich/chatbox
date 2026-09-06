package xyz.chatboxapp.chatbox;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/** Keeps the process and CPU alive only while user-initiated model streams are active. */
public class BackgroundGenerationService extends Service {
    private static final String TAG = "ChatboxBackground";
    private static volatile BackgroundGenerationService runningInstance;
    private static final String ACTION_START = "xyz.chatboxapp.chatbox.background.START";
    private static final String ACTION_STOP = "xyz.chatboxapp.chatbox.background.STOP";
    private static final String EXTRA_TASK_ID = "taskId";
    private static final String EXTRA_MAX_DURATION = "maxDurationMs";
    private static final String CHANNEL_ID = "chatbox_background_generation";
    private static final int NOTIFICATION_ID = 4721;
    private static final int DEFAULT_MAX_DURATION_MS = 30 * 60_000;
    private static final int STREAM_HANDOFF_GRACE_MS = 5_000;

    private final Set<String> activeTasks = new HashSet<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private boolean foregroundStarted;
    private final Runnable timeoutStop = this::stopAll;
    private final Runnable graceStop = this::stopAll;

    static Intent startIntent(Context context, String taskId, int maxDurationMs) {
        return new Intent(context, BackgroundGenerationService.class)
            .setAction(ACTION_START)
            .putExtra(EXTRA_TASK_ID, taskId)
            .putExtra(EXTRA_MAX_DURATION, maxDurationMs);
    }

    static Intent stopIntent(Context context, String taskId) {
        return new Intent(context, BackgroundGenerationService.class)
            .setAction(ACTION_STOP)
            .putExtra(EXTRA_TASK_ID, taskId);
    }

    static boolean stopTaskIfRunning(String taskId) {
        BackgroundGenerationService service = runningInstance;
        if (service == null) return false;
        service.handler.post(() -> service.handleStopTask(taskId));
        return true;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        runningInstance = this;
        try {
            createNotificationChannel();
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    getPackageName() + ":model-generation"
                );
                wakeLock.setReferenceCounted(false);
            }
        } catch (RuntimeException error) {
            // A background enhancement must never terminate the Chatbox process.
            Log.e(TAG, "Unable to initialize background generation", error);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        String taskId = intent.getStringExtra(EXTRA_TASK_ID);
        if (ACTION_STOP.equals(intent.getAction())) {
            handleStopTask(taskId);
            return START_NOT_STICKY;
        }

        if (!ACTION_START.equals(intent.getAction()) || taskId == null || taskId.isEmpty()) {
            return START_NOT_STICKY;
        }

        activeTasks.add(taskId);
        handler.removeCallbacks(graceStop);
        int duration = intent.getIntExtra(EXTRA_MAX_DURATION, DEFAULT_MAX_DURATION_MS);
        duration = Math.max(60_000, Math.min(duration, DEFAULT_MAX_DURATION_MS));
        try {
            startForeground(NOTIFICATION_ID, buildNotification());
            foregroundStarted = true;
            BackgroundGenerationPlugin.resolveStart(taskId);
        } catch (RuntimeException error) {
            Log.e(TAG, "Unable to promote background generation service", error);
            BackgroundGenerationPlugin.rejectStart(taskId, "Android rejected the foreground service notification");
            activeTasks.remove(taskId);
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        if (wakeLock != null && !wakeLock.isHeld()) wakeLock.acquire(duration);
        handler.removeCallbacks(timeoutStop);
        handler.postDelayed(timeoutStop, duration);
        return START_NOT_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            localizedText("Background responses"),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(localizedText("Keeps an active Chatbox response running while the app is in the background"));
        channel.setSound(null, null);
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    private void handleStopTask(String taskId) {
        if (taskId != null) activeTasks.remove(taskId);
        // A tool call can end one model stream and immediately start the next.
        // Keep the existing foreground service briefly so Android does not have
        // to authorize a brand-new background service between agent steps.
        if (activeTasks.isEmpty()) {
            handler.removeCallbacks(graceStop);
            handler.postDelayed(graceStop, STREAM_HANDOFF_GRACE_MS);
        }
    }

    private Notification buildNotification() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent contentIntent = launchIntent == null ? null : PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        builder
            // Launcher icons can be adaptive icons on Android 8+. They are not
            // valid notification small icons and may cause Bad notification posted,
            // which terminates the entire app process. This framework icon is a
            // guaranteed monochrome notification resource on every supported API.
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("Chatbox")
            .setContentText(localizedText("Generating a response in the background"))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_PROGRESS)
            .setVisibility(Notification.VISIBILITY_PRIVATE)
            .setShowWhen(false);
        if (contentIntent != null) builder.setContentIntent(contentIntent);
        return builder.build();
    }

    private void stopAll() {
        activeTasks.clear();
        handler.removeCallbacks(timeoutStop);
        handler.removeCallbacks(graceStop);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (foregroundStarted) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            foregroundStarted = false;
        }
        stopSelf();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(timeoutStop);
        handler.removeCallbacks(graceStop);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (runningInstance == this) runningInstance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /** Small native translation table because this service is injected without Android resources. */
    private String localizedText(String english) {
        String language = Locale.getDefault().getLanguage();
        boolean traditionalChinese = "zh".equals(language) && (
            "Hant".equalsIgnoreCase(Locale.getDefault().getScript()) ||
            "TW".equalsIgnoreCase(Locale.getDefault().getCountry()) ||
            "HK".equalsIgnoreCase(Locale.getDefault().getCountry()) ||
            "MO".equalsIgnoreCase(Locale.getDefault().getCountry())
        );
        if ("Background responses".equals(english)) {
            if (traditionalChinese) return "背景回覆";
            if ("zh".equals(language)) return "后台回复";
            if ("de".equals(language)) return "Hintergrundantworten";
            if ("es".equals(language)) return "Respuestas en segundo plano";
            if ("fr".equals(language)) return "Réponses en arrière-plan";
            if ("it".equals(language)) return "Risposte in background";
            if ("ja".equals(language)) return "バックグラウンド応答";
            if ("ko".equals(language)) return "백그라운드 응답";
            if ("nb".equals(language) || "no".equals(language)) return "Bakgrunnssvar";
            if ("pt".equals(language)) return "Respostas em segundo plano";
            if ("ru".equals(language)) return "Фоновые ответы";
            if ("sv".equals(language)) return "Bakgrundssvar";
            if ("ar".equals(language)) return "الردود في الخلفية";
            return english;
        }
        if ("Keeps an active Chatbox response running while the app is in the background".equals(english)) {
            if (traditionalChinese) return "讓進行中的 Chatbox 回覆在背景繼續生成";
            if ("zh".equals(language)) return "让进行中的 Chatbox 回复在后台继续生成";
            if ("de".equals(language)) return "Hält eine aktive Chatbox-Antwort im Hintergrund am Laufen";
            if ("es".equals(language)) return "Mantiene activa una respuesta de Chatbox en segundo plano";
            if ("fr".equals(language)) return "Maintient une réponse Chatbox active en arrière-plan";
            if ("it".equals(language)) return "Mantiene attiva una risposta di Chatbox in background";
            if ("ja".equals(language)) return "Chatbox の回答生成をバックグラウンドで継続します";
            if ("ko".equals(language)) return "Chatbox 답변 생성을 백그라운드에서 계속합니다";
            if ("nb".equals(language) || "no".equals(language)) return "Holder et aktivt Chatbox-svar i gang i bakgrunnen";
            if ("pt".equals(language)) return "Mantém uma resposta do Chatbox ativa em segundo plano";
            if ("ru".equals(language)) return "Продолжает активный ответ Chatbox в фоне";
            if ("sv".equals(language)) return "Håller ett aktivt Chatbox-svar igång i bakgrunden";
            if ("ar".equals(language)) return "يبقي رد Chatbox النشط قيد التشغيل في الخلفية";
            return english;
        }
        if (traditionalChinese) return "正在背景生成回覆";
        if ("zh".equals(language)) return "正在后台生成回复";
        if ("de".equals(language)) return "Antwort wird im Hintergrund generiert";
        if ("es".equals(language)) return "Generando una respuesta en segundo plano";
        if ("fr".equals(language)) return "Génération d’une réponse en arrière-plan";
        if ("it".equals(language)) return "Generazione della risposta in background";
        if ("ja".equals(language)) return "バックグラウンドで回答を生成中";
        if ("ko".equals(language)) return "백그라운드에서 답변 생성 중";
        if ("nb".equals(language) || "no".equals(language)) return "Genererer et svar i bakgrunnen";
        if ("pt".equals(language)) return "A gerar uma resposta em segundo plano";
        if ("ru".equals(language)) return "Ответ формируется в фоне";
        if ("sv".equals(language)) return "Genererar ett svar i bakgrunden";
        if ("ar".equals(language)) return "جارٍ إنشاء رد في الخلفية";
        return english;
    }
}
