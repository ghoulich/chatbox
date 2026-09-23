# MuMu v504 background image-generation regression

Date: 2026-09-23

Device: MuMu at `192.168.1.102:7555`

Package: `xyz.chatboxapp.chatbox`

Version: `1.23.2.504` (`versionCode 504`)

## Fix under test

Image generation previously did not participate in the Android foreground
generation service used by model streams. Turning the screen off could suspend
the WebView or interrupt a native HTTP request, and one polling/download error
immediately made the local job terminally failed.

v504 keeps every image-provider job protected from submission through local
storage, and stops protection in `finally` on success, failure, or cancellation.
ComfyUI history polling now retries transient HTTP/network failures, checks
history once after a delayed WebView resume even if the original deadline has
elapsed, and retries transient result downloads. Authentication and other
permanent HTTP failures still fail immediately.

## Automated and artifact checks

- Focused Vitest: 3 files, 29/29 tests passed.
- Root TypeScript `tsc --noEmit`: passed.
- `git diff --check`: passed.
- Android production renderer: 15,838 modules; 0 sourcemaps in the APK.
- APK size: 38,519,845 bytes.
- APK SHA-256: `5af57b77a383a2d74b0d40822a69af247a53d8eed176efa1130fb6cb1d230617`.
- ZIP page-aware alignment and compressed-data integrity: passed.
- APK Signature Schemes v1/v2/v3: passed; signing certificate SHA-256 remains
  `68f4e0a813378e50487565b01a21ffe670466612e172018af4b40775d66c0912`.
- Package metadata: minSdk 23, target/compileSdk 35.

## Real screen-off test

The first signed v504 candidate was installed with `adb install -r`; no
uninstall or data clear was performed. The existing `unholy_illustrious`
ComfyUI workflow and private endpoint configuration were retained.

1. Submitted `a red crystal fox on a dark background` from the Android image
   generator.
2. One second later sent Android `KEYCODE_SLEEP`. The device reported
   `mWakefulness=Asleep` and display state `OFF`.
3. While the display was off, `BackgroundGenerationService` remained a
   foreground service and the process held
   `xyz.chatboxapp.chatbox:model-generation` as a partial WakeLock.
4. After roughly 46 seconds asleep the service, process, and WakeLock were still
   active. At roughly 67 seconds the process remained alive while the WakeLock
   had been released by the app, indicating normal terminal cleanup.
5. On wake, the completed fox image was displayed at full size and was the first
   image-history entry. A preceding blue-glass-sphere run also completed its
   server polling, download, local storage, display, and thumbnail history.

Filtered logcat contained no application FATAL exception, JavaScript
`TypeError`/`ReferenceError`/`SyntaxError`, ComfyUI generation failure, or error
boundary. Final review then found the explicit retry action needed the same
lifecycle wrapper; that additive path was covered by the 29th unit test, the
final APK above was rebuilt, reinstalled over the candidate, and passed a cold
start/version/log check. The already tested first-generation path was unchanged.
The two v504 test records (fox and luminous sphere) were then deleted through
the app UI; pre-existing user/history records were left intact.

This run validates MuMu only; physical-device/OEM battery policy is not
represented. The user-facing **Continue generating in background** setting must
remain enabled, and the native service retains its 30-minute hard stop.
