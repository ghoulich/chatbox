# Android wrapper overrides

The upstream `v1.23.2` release does not provide a generated Capacitor
`android/` project or an Android APK asset. The customized APK therefore uses
the previously validated v1.22.3 custom wrapper and native plugin baseline,
then replaces its renderer assets with a fresh v1.23.2 mobile build from this
source tree. Rebase the wrapper when an official v1.23.2 Android artifact or a
complete Android project becomes available.

The reproducible native overrides are kept here:

- `network_security_config.xml` trusts the Android system CA store and the
  user-installed CA store. TLS hostname verification remains enabled.
- `capacitor.config.json` keeps native HTTP available and disables immersive
  and full-screen splash behavior.
- `MainActivity.non-fullscreen.smali` documents the activity override applied
  to the decoded wrapper. It restores system bars after creation and whenever
  the window regains focus.
- `styles-app-theme.xml` and `styles-v35-app-theme.xml` contain the relevant
  theme declarations used by the decoded wrapper.
- `DocumentSaverPlugin.java` adds persistent Android Storage Access Framework
  directory selection and recursive, read-only `SKILL.md` scanning. It exposes
  no local script execution.
- `build-document-saver-plugin.sh` compiles that plugin into a standalone DEX.
  Rebuild and inject it whenever the Java bridge changes; an older DEX may still
  register as `DocumentSaver` while silently lacking newly added plugin methods.
- `NetworkToolsPlugin.java` provides bounded, in-process Android network
  diagnostics (network info, ICMP/TCP latency, DNS, HTTP/TLS, mDNS, LAN/Wi-Fi
  discovery, speed test, SSH and read-only SNMP). SSH/SNMP secrets are encrypted
  with Android Keystore and are never exposed to the model. SSH profiles with no
  configured host-key fingerprint use trust-on-first-use, persist the observed
  SHA-256 fingerprint privately, and reject subsequent key changes.
- `manifest-network-permissions.xml` and
  `MainActivity.register-network-tools.smali` record the recovered-wrapper
  manifest and plugin-registration changes.
- `BackgroundGenerationPlugin.java` and `BackgroundGenerationService.java`
  keep user-initiated model streams and image-generation jobs alive while
  Chatbox is backgrounded. The
  foreground service displays a private notification, holds a partial wake
  lock only while streams are active, keeps a five-second handoff window
  between agent/tool streams, and enforces a 30-minute hard stop.
- `manifest-background-generation.xml`,
  `MainActivity.register-background-generation.smali`, and
  `StreamHttpPlugin.background.patch` record the corresponding wrapper,
  Capacitor registration, and unlimited SSE read-timeout changes. Android 13+
  notification permission is declared but is not requested from the critical
  model-stream startup path. Android does not require that runtime permission
  to launch an FGS; if notifications are disabled, its notice remains visible
  in Android's active-app Task Manager.

The decoded build wrapper is intentionally kept outside this Git worktree at
`../../../chatbox-v1.23.1-apk-build` so thousands of generated files are not mixed
with the maintained TypeScript changes. The directory name is historical; its
current renderer assets are built from v1.23.2. The current signed output is
`../../../chatbox-1.23.2-custom-v504-signed.apk` (`versionName 1.23.2.504`,
`versionCode 504`). v504 includes the earlier Settings Store crash fix plus
Android Skills/remote MCP, media and diagram rendering, offline KaTeX,
session-attachment inline/retrieval selection, native embedding/reranking
requests, cross-platform automatic attachment routing, and automatic title
generation for copilot sessions. It also adds a configurable self-hosted
Firecrawl webpage reader, deterministic image-search routing with fallback
media cards, modern adaptive Mermaid styling, and self-hosted ComfyUI image
generation with Basic Auth username/password, `Comfy-User` support, a
multi-workflow library, a form designer for text-to-image/image-to-image/LoRA/
ControlNet, paired API/UI workflow generation, revision-safe Workflow Bridge
synchronization, Android reference-image upload, workflow-first dimensions with
configurable width/height fallbacks, and a default image model. Its Phase 3 Lite
runtime adds workflow-owned basic/advanced parameters, capability recommendations,
queue/progress/cancellation/recovery state, reproducible workflow/revision/
parameter/seed metadata with setting reuse, bounded mobile image preprocessing,
and Android SQLite persistence for ComfyUI metadata and terminal progress.
All image providers now hold the Android background-generation service for the
complete job lifetime. ComfyUI history polling retries transient screen-off
network failures, performs a final history check after WebView resume, and
retries the result download before marking the generation failed.
Mobile attachment indexing
additionally retries transient batch failures, saves completed batches as
checkpoints, resumes from the first missing vector, and distinguishes indexing
failures from parsing failures in the UI. See the local handoff outside the
public repository and
`../../test-evidence/mumu-v504/TEST_REPORT.md` before
rebuilding.

Security note: trusting a user-installed CA enables HTTPS to servers signed by
that CA, but does not disable TLS or hostname validation. Installing an
untrusted CA on the phone grants it the same trust for this app, so only install
the CA that controls the intended server.

`comfyui-workflows/sd15-basic-api.json` is the minimal 512×512 SD 1.5 API
workflow used for the v495 Android end-to-end generation check. Its standard
nodes are auto-detected by Chatbox and its configured dimensions intentionally
take precedence over the 1024×1024 fallback values.

When rebuilding the decoded Android wrapper, use page-aware alignment
(`zipalign -p -f 4`) before signing. Plain alignment can leave native `.so`
libraries incorrectly page-aligned and cause installation to fail even when the
APK signature itself is valid.
