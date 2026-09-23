# Chatbox v1.23.2 custom v503 regression report

Date: 2026-09-10 (UTC)

Target: Android / MuMu emulator at the configured ADB endpoint

Package: `xyz.chatboxapp.chatbox`

Installed version: `1.23.2.503` (`versionCode 503`)

## Scope

The official `v1.23.2` tag (`1898ee00d542d7e4d91dad4bc5385b3adb1ed0c7`) was merged into the complete v502 Android custom branch. Merge conflicts were resolved by retaining both the upstream changes and the custom Android features. The review covered settings/schema migrations, generation cancellation, native streaming, OAuth/MCP, attachment retrieval, backup compatibility, session naming, media rendering and all custom Android integrations.

## Source and automated checks

- No unresolved merge paths remained.
- The root TypeScript `tsc --noEmit` check passed.
- The 50-file custom-feature suite passed: 590/590 tests.
- A focused post-merge suite for Android attachment ownership, Markdown/media fallback, native streaming, native mobile requests and MCP mobile fetch passed: 58/58 tests.
- The image-generation action suite passed: 10/10 tests.
- The first broad changed-file run exposed two stale upstream assertions, one missing failed-image fallback link and one load-related timeout. The assertions and fallback were corrected; the affected suites and the timed-out image suite then passed independently. The failed-image fallback now retains both a translated direct image link and the source link.
- All 14 locale JSON files parse successfully and custom interface strings remain translated.
- The Android renderer production build completed with 15,838 modules. The copied release assets and APK contain no source maps.

## APK verification

Artifact: `chatbox-1.23.2-custom-v503-signed.apk`

- Size: 38,519,845 bytes
- SHA-256: `8f028d223911c4e7658b8967ce0b4cb8e7bb68aec6cafcf7a54e3dcd4e432603`
- minSdk: 23
- target/compile SDK: 35
- Page-aware ZIP alignment: passed
- ZIP integrity: passed
- APK signatures: v1/v2/v3 passed; v4 is not enabled
- Signing certificate SHA-256: `68f4e0a813378e50487565b01a21ffe670466612e172018af4b40775d66c0912`

The APK was installed with `adb install -r` over v502. The old package was not uninstalled and application data was preserved. Package metadata and the About entry both report `1.23.2.503`.

## MuMu regression results

- Cold launch completed without a white screen or application crash; existing sessions and settings were preserved.
- Android SAF Skills refresh still discovers two imported skills. The agent extension badge shows `2`, matching the expanded list rather than counting stale configured names.
- Android Chat Mode still exposes Skills and remote MCP. Desktop-only code execution and working-directory behavior remains restricted.
- SearXNG and the Firecrawl webpage reader retained their configuration. A real Firecrawl connection/scrape check succeeded.
- A new image request loaded the configured search skill, invoked image search and rendered inline thumbnails plus source links. The temporary test session was removed.
- A new architecture request rendered a modern dark Mermaid diagram rather than a text approximation. The temporary test session was removed.
- An existing Three.js teaching animation loaded in the sandbox runner. No new sandbox rejection was observed. Historical generated content is not rewritten.
- Turning background generation off and on did not reproduce `settingsStore.getState(...).getSettings is not a function`; the ready state remained healthy.
- The attachment setting shows the cross-platform automatic policy and the configured embedding/reranking models. The previously documented MuMu PDF parser limitation was not retested, per user direction.
- ComfyUI Basic Auth connectivity succeeded and discovered three checkpoint models. Workflow Bridge health reported version `0.1.0` with zero managed workflows before this test.
- The mobile form designer created a temporary 512×512 SD 1.5 text-to-image workflow. The image creator selected it and completed a real end-to-end generation in about 28 seconds; the result and history thumbnail rendered correctly.
- The generated image, history item and temporary local workflow were deleted after verification. No remote Bridge workflow was created by this local-only test.
- Final filtered logs contained no `FATAL`, JavaScript `TypeError`/`ReferenceError`/`SyntaxError`, error-boundary failure, ComfyUI error or sandbox security rejection. MuMu's recurring Chromium `SharedImageLifetimeDebug` messages are emulator GPU diagnostics rather than application failures.

## Evidence index

- `01-cold-start.png`: preserved data and About version `1.23.2.503`
- `03-skills.png`, `04-skills-refreshed.png`: Skills discovery and refresh
- `12-background-toggle.png`: background-generation setting after off/on regression
- `15-attachment-models.png`: automatic attachment policy and model selectors
- `17-agent-extensions.png`, `18-agent-skills-list.png`: enabled extensions and exact Skills count
- `19-threejs-history.png`: Three.js runtime rendering
- `20-mermaid-new.png`: newly generated Mermaid architecture diagram
- `21a-image-search-tool.png`, `21-image-search-new.png`: skill/tool invocation and inline image results
- `22-cleaned-test-sessions.png`: temporary conversation cleanup
- `24-comfy-workflow-created.png`: mobile workflow designer result
- `25-comfy-real-generation.png`: real ComfyUI generation and history thumbnail
- `26-comfy-cleaned.png`: local workflow cleanup
- `27-final-cold-start.png`: final clean cold launch with version `1.23.2.503`

Screens that exposed private service configuration were intentionally excluded from the committed evidence set.

## Remaining limits

- This pass used one MuMu instance; it is not a multi-vendor physical-device matrix.
- The user previously confirmed the target PDF can index on a physical phone, but this v503 pass did not repeat physical-phone testing.
- No compatible LoRA or ControlNet model was available for real inference. Their schemas, forms and node mappings remain covered by automated tests; SD 1.5 text-to-image was exercised end to end.
- SSH/SNMP devices, negative user-CA/hostname cases, long background streams and sustained low-memory/WebGL stress require controlled external environments and remain release-matrix work.

## ComfyUI replacement-inventory regression (2026-09-23 UTC)

The server's previous ComfyUI models and workflows had been removed and replaced,
so this pass discarded the earlier inventory and queried the live server again.
No endpoint, username, password, token, or private application database is stored
in this report.

### Live inventory

- Workflow Bridge health: `ok`, version `0.1.0`, maximum workflow body 10 MiB.
- Managed workflows: `unholy_anima` and `unholy_illustrious`, both revision 1 and
  both declaring text-to-image capability.
- The two native source files also appear as unmanaged workflows. This is expected:
  Bridge synchronization creates managed copies and does not overwrite or delete
  the original native ComfyUI saves.
- Checkpoint: `unholyDesireMixSinister_v80.safetensors`.
- Diffusion model: `anima_aesthetic_v1.1.safetensors`.
- Text encoder: `qwen_3_06b_base.safetensors`.
- VAE: `qwen_image_vae.safetensors`.
- No LoRA models were present.
- The ComfyUI queue was empty before the test.

### MuMu end-to-end results

- **Bridge refresh and pull passed.** Chatbox retained the old local-only workflow
  instead of silently deleting it, discovered both new remote workflows, pulled
  each revision, and changed the active workflow without a restart.
- **`unholy_illustrious` passed.** Chatbox submitted prompt
  `8cd459ec-31d8-4003-8153-ff86f2280856`; ComfyUI reported success in about
  11.8 seconds. The returned PNG is 832×1216 and 1,030,429 bytes. Chatbox completed
  its download state, displayed the image in the main result view, and added the
  thumbnail to local history.
- **`unholy_anima` passed transport/runtime but failed output quality.** ComfyUI
  completed prompt `8c408bed-b292-49a8-b0a1-6e285356936f`; the returned PNG is
  832×1216 and 1,975,760 bytes. Chatbox completed progress, download, display and
  history persistence, but the image is visual noise. The synchronized nine-node
  graph uses `UNETLoader` + Qwen-Image `CLIPLoader` + `VAELoader` and connects the
  model directly to a plain `KSampler`. The workflow/model sampling requirements
  should be corrected and validated in ComfyUI, then synchronized as a new
  revision. No Chatbox source change is indicated by this result.
- **Cold restart passed.** The image history and selected workflow survived an
  Android force-stop/relaunch. The final active workflow was restored to the
  known-good `unholy_illustrious` profile.
- **Runtime health passed.** Filtered Android logs contained no application fatal
  exception or Chromium JavaScript `TypeError`/`ReferenceError` after the refresh,
  two generations and cold restart.

### Source verification

The focused source suite passed 30/30 tests across:

- `src/renderer/packages/comfyui/bridge-client.test.ts`
- `src/renderer/packages/comfyui/client.test.ts`
- `src/renderer/packages/comfyui/image-preprocess.test.ts`
- `src/renderer/packages/comfyui/workflows.test.ts`

This pass changed documentation only; no APK rebuild was required.
