# MuMu v497 ComfyUI Phase 2 regression

Date: 2026-09-09

Device: MuMu emulator at `192.168.1.102:7555`

Package: `xyz.chatboxapp.chatbox`

Version: `versionName 1.23.1.497`, `versionCode 497`

## Artifact

- APK: `chatbox-1.23.1-custom-v497-signed.apk`
- Size: 38,487,077 bytes
- SHA-256: `8e099a460fc2d12b493744e4148f8dd35deabfe594a159270347193e4384a99b`
- Signing certificate SHA-256: `68f4e0a813378e50487565b01a21ffe670466612e172018af4b40775d66c0912`
- APK Signature Schemes v1/v2/v3: verified
- Page-aware ZIP alignment: verified with `zipalign -c -p -v 4`
- APK sourcemaps: 0

The APK was installed with `adb install -r`; the previous version was not
uninstalled and application data was retained.

## Automated checks

- Five affected Vitest files: 68/68 tests passed.
- Root TypeScript check: passed.
- Renderer Android production build: passed (15,821 modules).
- `git diff --check`: passed before documentation finalization and rerun after it.
- All 14 bundled locales contain all 110 translated UI keys used by the
  settings page and image creator.

## Service and device regression

- The deployed Workflow Bridge health endpoint returned version `0.1.0` and a
  10 MiB maximum workflow size.
- Bridge create/get/list/update/delete were exercised against the real service.
  A stale revision was rejected with HTTP 409.
- Real ComfyUI discovery returned two checkpoints and no LoRA or ControlNet
  models. The connection and Bridge readiness notifications were shown in
  Simplified Chinese.
- The workflow designer displayed text-to-image, image-to-image, LoRA, and
  ControlNet controls. Image-to-image hides width/height because the source image
  owns those dimensions; ControlNet displays model, strength, start/end ratios,
  width/height, and sampling controls.
- A generated image-to-image profile was synchronized to the Bridge. Android's
  photo picker supplied one reference image, the app uploaded it through the
  authenticated native multipart path, submitted the generated API workflow,
  polled history, downloaded the result, and displayed it in the main view and
  local history.
- Submitting an image-to-image profile without a reference displayed the
  localized error `当前 ComfyUI 工作流需要一张参考图。`.
- The destructive synchronized-workflow action used an in-app localized modal
  (`删除` / `取消`) rather than Android's English `CANCEL` / `OK` dialog.
- Both test-managed workflows were removed from Chatbox and the Bridge after
  verification. The existing unmanaged `wan22-5b` ComfyUI workflow was not
  modified. Three generated test history records and the emulator reference
  file were removed.
- A final cold start kept `1.23.1.497` active and produced no FATAL exception,
  JavaScript `TypeError`/`ReferenceError`/`SyntaxError`, or application error
  boundary. MuMu Chromium's `SharedImageLifetimeDebug` output remains unrelated
  GPU-emulation noise.

## Honest coverage boundary

The real service currently exposes zero LoRA and zero ControlNet models, so
their model-specific inference was not claimed as an end-to-end pass. Their
form behavior, schema, workflow graph construction, validation, synchronization,
and translation paths are covered; actual inference requires installing
compatible server-side models.
