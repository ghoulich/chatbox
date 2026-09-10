# MuMu v502 ComfyUI Phase 3 Lite regression

Date: 2026-09-10

Device: MuMu, `192.168.1.102:7555`

Package: `xyz.chatboxapp.chatbox`

Installed version: `1.23.1.502` (`versionCode 502`)

## Scope

This run validates the mobile-focused ComfyUI Phase 3 Lite implementation on top
of the v497 multi-workflow and Workflow Bridge support:

- workflow-owned basic and advanced generation parameters;
- capability-based workflow recommendation;
- queue, execution, download, completion, cancellation, and recovery states;
- reproducible workflow/parameter/seed metadata and **Reuse Settings**;
- bounded reference-image preprocessing before Android upload;
- Android SQLite persistence for ComfyUI metadata and terminal progress.

The full ComfyUI node canvas, unlimited LoRA/ControlNet stacks, professional mask
editing, and desktop-style batch debugging remain intentionally out of scope.

## Automated verification

- Targeted Vitest regression: 9 files, 86/86 tests passed.
- Root TypeScript check: `tsc --noEmit` passed.
- `git diff --check` passed.
- Android renderer production build completed with 15,824 modules.
- The affected custom strings are present in all 14 bundled locales. The final
  Simplified Chinese UI displays “采样步数” rather than falling back to English.

The repository-wide Vitest suite is not claimed as green because the current
workspace still has pre-existing Electron/sandbox/file-parser environment
failures unrelated to this change. Biome formatting was applied, but the lint
command did not complete reliably in this environment and is not reported as a
passing gate.

## APK verification

Artifact outside the public repository:
`chatbox-1.23.1-custom-v502-signed.apk`

| Check | Result |
|---|---|
| Size | 38,495,269 bytes |
| SHA-256 | `f13450801512cca7f38135c0c8dba20b94cca5e0c8c9952618c805a128afbf8d` |
| SDK | min 23; target/compile 35 |
| Signature | v1/v2/v3 true; v4 false |
| Certificate SHA-256 | `68f4e0a813378e50487565b01a21ffe670466612e172018af4b40775d66c0912` |
| ZIP alignment | `zipalign -c -p -v 4` passed |
| Archive integrity | passed |
| Bundled source maps | 0 |

The APK was installed with `adb install -r`; the old app was not uninstalled and
application data was retained. Package metadata and the in-app About label both
reported `1.23.1.502`.

## MuMu end-to-end results

1. The existing HTTPS ComfyUI connection with Basic Auth passed its real
   connection check and discovered two checkpoints.
2. A temporary local SD 1.5 text-to-image workflow was created. Its runtime
   panel exposed width, height, sampling steps, CFG, seed, sampler, scheduler,
   denoise, and capability-dependent advanced controls without requiring a node
   canvas.
3. A real 512×512 generation was submitted with fixed seed `498`. The UI moved
   through generation and download states, displayed the final image, and wrote
   a local history thumbnail.
4. **Reuse Settings** restored the exact prompt, workflow, parameters, and seed
   from generation metadata.
5. An early in-flight cancellation reached a gray terminal “已取消生成” state and
   did not show a failure card. This exposed and led to a fix for a callback race
   that could otherwise overwrite local cancellation with a later queued update.
6. A second cancellation was persisted, the app was force-stopped, and a cold
   launch still showed the same canceled state, workflow name, and **Reuse
   Settings** action. This validates the Android SQLite schema-v3 migration for
   `comfyui_metadata` and `progress`.
7. The final cold launch had a live process/MainActivity and no FATAL,
   `TypeError`, `ReferenceError`, `SyntaxError`, or application error boundary in
   the inspected log window.

Reference-image bounding/resizing and workflow recommendations are covered by
unit and UI-path tests. A real image-to-image upload/inference was already
completed on v497 and was not repeated for v502. The service exposed no LoRA or
ControlNet models, so their form/schema/node/mapping paths are covered but real
model inference is not claimed.

## Cleanup

All six image-generation test history records, the unsent prompt draft, and the
temporary local workflow were removed after verification. Existing ComfyUI
endpoint, authentication, model settings, user conversations, and unmanaged
remote workflows were preserved.

## Evidence index

- `01-runtime-panel-basic.png`: workflow-owned basic controls.
- `02-runtime-panel-advanced.png`: advanced runtime controls.
- `03-real-generation-result.png`: real generated image and local history.
- `04-runtime-panel-zh-hans.png`: final Simplified Chinese sampling-step label.
- `05-early-cancel-terminal.png`: true early cancellation terminal state.
- `06-cancel-persisted-immediate.png`: cancellation before restart.
- `07-cancel-persisted-relaunch.png`: the same record after force-stop/cold launch.
