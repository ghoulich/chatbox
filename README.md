<p align="right">
  <a href="README.md">English</a> |
  <a href="./doc/README-CN.md">简体中文</a>
</p>

<h1 align="center">
<img src='./doc/statics/icon.png' width='30'>
<span>
    Chatbox
    <span style="font-size:8px; font-weight: normal;">(Community Edition)</span>
</span>
</h1>
<p align="center">
    <em>Your Ultimate AI Copilot on the Desktop. <br />Chatbox is a desktop client for ChatGPT, Claude and other LLMs, available on Windows, Mac, Linux</em>
</p>

<p align="center">
<a href="https://github.com/chatboxai/chatbox/releases" target="_blank">
<img alt="macOS" src="https://img.shields.io/badge/-macOS-black?style=flat-square&logo=apple&logoColor=white" />
</a>
<a href="https://github.com/chatboxai/chatbox/releases" target="_blank">
<img alt="Windows" src="https://img.shields.io/badge/-Windows-blue?style=flat-square&logo=windows&logoColor=white" />
</a>
<a href="https://github.com/chatboxai/chatbox/releases" target="_blank">
<img alt="Linux" src="https://img.shields.io/badge/-Linux-yellow?style=flat-square&logo=linux&logoColor=white" />
</a>
<a href="https://github.com/chatboxai/chatbox/releases" target="_blank">
<img alt="Downloads" src="https://img.shields.io/github/downloads/chatboxai/chatbox/total.svg?style=flat" />
</a>
<a href="#features">
<img alt="Privacy" src="https://img.shields.io/badge/-Local%20First-green?style=flat-square&logo=shield&logoColor=white" />
</a>
</p>

<p align="center">
<a href="https://www.producthunt.com/posts/chatbox?utm_source=badge-featured&utm_medium=badge&utm_souce=badge-chatbox" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=429547&theme=light" alt="Chatbox - Better&#0032;UI&#0032;&#0038;&#0032;Desktop&#0032;App&#0032;for&#0032;ChatGPT&#0044;&#0032;Claude&#0032;and&#0032;other&#0032;LLMs&#0046; | Product Hunt" style="width: 150px; height: 30px;" width="100" height="40" /></a>
<a href="https://trendshift.io/repositories/14871" target="_blank"><img src="https://trendshift.io/api/badge/repositories/14871" alt="chatboxai%2Fchatbox | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="./doc/statics/snapshot_light.png">
    <img src="./doc/statics/snapshot_light.png" width="400"/>
  </a>
  <a href="./doc/statics/snapshot_dark.png">
    <img src="./doc/statics/snapshot_dark.png" width="400"/>
  </a>
</p>

---

This is the repository for the Chatbox Community Edition, open-sourced under the GPLv3 license.

[Chatbox is going open-source Again!](https://github.com/chatboxai/chatbox/issues/2266)

We regularly sync code from the pro repo to this repo, and vice versa.

## ghoulich Android Custom Edition

This fork is based on the official Chatbox `v1.23.2` source and carries an
Android-focused secondary-development branch. The current custom build version
is `1.23.2.503`. It retains the upstream desktop and web code while adding the
following Android capabilities:

- Read-only Skills directory access through Android SAF, in-chat `load_skill`,
  enabled Skills controls, and remote HTTP/SSE MCP in Android Chat Mode.
- SearXNG web, image, and video search with optional authentication and engine
  selection. Explicit image requests are routed to image search, and resilient
  inline galleries/cards keep the image preview and source link available even
  when a model omits or rewrites the returned media URL. Video thumbnails also
  distinguish content that can play in Chatbox from links that must open on the
  web.
- Configurable webpage reading through either Chatbox's native `parse_link` or
  a self-hosted Firecrawl service. Firecrawl supports an optional Bearer token,
  a bounded timeout, Android native HTTP transport, and an explicit native
  fallback switch that is disabled by default.
- First-class self-hosted ComfyUI image generation with endpoint and optional
  Basic Auth username/password, checkpoint/LoRA/ControlNet discovery, a
  multi-workflow library, and a mobile-friendly form designer for text-to-image,
  image-to-image, optional LoRA, and ControlNet workflows. The companion Workflow
  Bridge synchronizes paired editable UI-format and executable API-format files,
  detects revision conflicts, and keeps normal ComfyUI workflows visible without
  exposing the broad `/userdata` API. The Phase 3 Lite runtime adds workflow-owned
  basic/advanced parameter forms, capability recommendations, queue/progress/
  cancellation/recovery states, reproducible workflow/parameter/seed metadata,
  one-tap setting reuse, and bounded mobile reference-image preprocessing before
  upload. Result download into local history, advanced JSON import, and existing
  cloud image providers remain available.
- Soul/persona injection for new Android conversations and automatic titles for
  copilot sessions without overwriting titles edited by the user.
- Local Android network diagnostics, including DNS, ping/TCP/HTTP/TLS, Wi-Fi and
  LAN discovery, bounded speed tests, SSH, and read-only SNMP. Secrets are kept
  outside model-visible tool results.
- Foreground-service-assisted background generation, persistent notifications,
  bounded wake locks, and the Settings Store crash fix for the background toggle.
- Responsive Mermaid diagrams with adaptive light/dark modern themes, semantic
  color guidance, improved spacing and polished containers, plus sandboxed
  Three.js teaching animations with full-screen layout, touch
  rotation/pan/pinch controls, offline KaTeX fonts, lifecycle cleanup, and
  narrowly scoped security rules.
- Per-conversation attachment handling with inline text or embedding retrieval,
  optional reranking, a cross-platform automatic size/type policy, retriable
  embedding batches, persisted checkpoints, and resumable mobile indexing.
- Android document export, user-installed CA support with hostname verification,
  mobile UI fixes, and complete translations for all custom UI text in the 14
  bundled locales.

The upstream `v1.23.2` snapshot does not contain a complete generated Capacitor
Android project. The APK is currently assembled with the maintained overrides in
[`custom/android`](./custom/android) and a separately decoded, previously
validated wrapper. Signing keys, passwords, APK binaries, private model/search
configuration, and application databases are intentionally not committed.

Implementation notes are in [`custom/android/README.md`](./custom/android/README.md),
and the latest device/test evidence is in
[`test-evidence/mumu-v503/TEST_REPORT.md`](./test-evidence/mumu-v503/TEST_REPORT.md).
The MuMu PDF parser can remain at “Preparing” before indexing; the v491 indexing
reliability changes were separately verified with a large text attachment on
MuMu and the same PDF was manually confirmed by the user on a physical phone.

### Firecrawl setup

Open **Settings → Web Search → Webpage Reader**, select **Firecrawl**, and enter
the base URL of the self-hosted service (for example,
`https://firecrawl.example.com`). Add a Bearer token only when the service
requires one, choose a timeout, and use **Check connection** to run a real scrape
request. Enable **Fall back to native reading** only if the Android device is
allowed to fetch the target page itself when Firecrawl fails; leaving it
disabled keeps webpage traffic on Firecrawl.

### ComfyUI setup

Open **Settings → ComfyUI Image Generation**, enter the base URL of ComfyUI or
an authenticated reverse proxy, and add the Basic Auth username and password
when required. Set **ComfyUI User ID** only when the server uses the `Comfy-User`
header. Use **Check ComfyUI Connection** to load checkpoints, LoRAs, and
ControlNet models, then use **Check Workflow Bridge** to verify synchronization.

The **Workflow Designer** creates paired editable and executable workflows from
a compact form. It supports text-to-image, image-to-image, one optional LoRA,
and ControlNet; image-to-image and ControlNet require one reference image per
generation. Use **Workflow Library** to select, push, pull, or delete synchronized
profiles. Concurrent edits are protected by remote revision checks instead of
silently overwriting another client's changes. A workflow created normally in
ComfyUI must first be opened there and synchronized with **Chatbox Bridge → Sync
current workflow to ChatBox** before it appears as a managed workflow in Chatbox.

In **Image Creator**, use the workflow button beside the upload action to choose
the active workflow and edit only the parameters that workflow exposes. Chatbox
recommends compatible workflows from their declared capabilities, shows queued,
running, downloading, completed, or cancelled state, and can recover an existing
ComfyUI prompt after an app restart. Generation history records the workflow
revision, effective parameters, final seed, and reference-image processing; use
**Reuse Settings** to reproduce or refine a prior result.

Advanced users can still import or paste API-format JSON. Standard checkpoint,
prompt, sampler, latent-image, image-loading, LoRA, and ControlNet nodes are
detected where supported; custom workflows can map inputs with
`nodeId.inputName`. A checkpoint can optionally be selected under **Settings →
Default Models → Default Image Generation Model**.

Valid width and height values (or node links) already present in the workflow
take precedence. The configurable default width and height only fill missing or
invalid workflow inputs. Chatbox hides its generic aspect-ratio selector while
ComfyUI is selected because the workflow owns the final dimensions.

A minimal SD 1.5 API workflow used for Android end-to-end testing is available
at [`custom/android/comfyui-workflows/sd15-basic-api.json`](./custom/android/comfyui-workflows/sd15-basic-api.json).

Workflow synchronization uses the repository-owned
[`custom/comfyui-workflow-bridge`](./custom/comfyui-workflow-bridge) extension.
It stores paired editable UI-format and executable API-format workflows inside
ComfyUI's user-scoped storage without exposing the broad `/userdata` API. See
the extension README for verification, host-mount/container installation,
Ingress, upgrade, and removal instructions.

### ComfyUI mobile Phase 3 Lite

Phase 3 Lite is implemented as a mobile runtime rather than a clone of ComfyUI's
node canvas. It includes workflow-owned basic/advanced parameter forms,
capability-based workflow recommendations, queue/progress/cancellation and
recovery, reproducible generation metadata, and mobile-safe reference-image
resizing/upload. Full node-graph editing, unlimited LoRA/ControlNet stacks,
professional mask editing, and desktop-style batch debugging remain out of scope
for Android.

## Download

### Desktop

<table style="width: 100%">
  <tr>
    <td width="25%" align="center">
      <b>Windows</b>
    </td>
    <td width="25%" align="center" colspan="2">
      <b>MacOS</b>
    </td>
    <td width="25%" align="center">
      <b>Linux</b>
    </td>
  </tr>
  <tr style="text-align: center">
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-windows'>
        <img src='./doc/statics/windows.png' style="height:24px; width: 24px" />
        <br />
        <b>Setup.exe</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-mac-intel'>
        <img src='./doc/statics/mac.png' style="height:24px; width: 24px" />
        <br />
        <b>Intel</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-mac-aarch'>
        <img src='./doc/statics/mac.png' style="height:24px; width: 24px" />
        <br />
        <b style="white-space: nowrap;">Apple Silicon</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-linux'>
        <img src='./doc/statics/linux.png' style="height:24px; width: 24px" />
        <br />
        <b>AppImage</b>
      </a>
    </td>
  </tr>
</table>

### iOS/Android

<a href='https://apps.apple.com/app/chatbox-ai/id6471368056' style='margin-right: 4px'>
<img src='./doc/statics/app_store.webp' style="height:38px;" />
</a>
<a href='https://play.google.com/store/apps/details?id=xyz.chatboxapp.chatbox' style='margin-right: 4px'>
<img src='./doc/statics/google_play.png' style="height:38px;" />
</a>
<a href='https://chatboxai.app/install?download=android_apk' style='margin-right: 4px; display: inline-flex; justify-content: center'>
<img src='./doc/statics/android.png' style="height:28px; display: inline-block" />
.APK
</a>

For more information: [chatboxai.app](https://chatboxai.app/)

## Quick Start

### For End Users
1. Download the appropriate installer for your platform from the [releases page](https://github.com/chatboxai/chatbox/releases)
2. Install and launch Chatbox
3. Configure your AI provider (OpenAI, Claude, etc.) in settings
4. Start chatting!

### System Requirements

| Platform | Minimum Version | Architecture |
|----------|----------------|--------------|
| Windows | Windows 10 | x64 |
| macOS | macOS 11 (Big Sur) | Intel/Apple Silicon |
| Linux | Ubuntu 20.04+ / AppImage supported distros | x64 |

<!-- <table>
<tr>
<td>
<img src="./dec/../doc/demo_mobile_1.png" alt="App Screenshot" style="box-shadow: 2px 2px 10px rgba(0,0,0,0.1); border: 1px solid #ddd; border-radius: 8px; height: 300px" />
</td>
<td>
<img src="./dec/../doc/demo_mobile_2.png" alt="App Screenshot" style="box-shadow: 2px 2px 10px rgba(0,0,0,0.1); border: 1px solid #ddd; border-radius: 8px; height: 300px" />
</td>
</tr>
</table> -->

## Features

### 🤖 AI Model Support
-   **Support for Multiple LLM Providers**  
    :gear: Seamlessly integrate with a variety of cutting-edge language models:
    -   OpenAI (ChatGPT)
    -   Azure OpenAI
    -   Claude
    -   Google Gemini Pro
    -   Ollama (enable access to local models like llama2, Mistral, Mixtral, codellama, vicuna, yi, and solar)
    -   ChatGLM-6B

-   **Image Generation with Dall-E-3**  
    :art: Create the images of your imagination with Dall-E-3.

-   **Enhanced Prompting**  
    :speech_balloon: Advanced prompting features to refine and focus your queries for better responses.

### 🖥️ User Experience
-   **Local Data Storage**  
    :floppy_disk: Your data remains on your device, ensuring it never gets lost and maintains your privacy.

-   **No-Deployment Installation Packages**  
    :package: Get started quickly with downloadable installation packages. No complex setup necessary!

-   **Ergonomic UI & Dark Theme**  
    :new_moon: A user-friendly interface with a night mode option for reduced eye strain during extended use.

-   **Keyboard Shortcuts**  
    :keyboard: Stay productive with shortcuts that speed up your workflow.

-   **Streaming Reply**  
    :arrow_forward: Provide rapid responses to your interactions with immediate, progressive replies.

### 📄 Content & Formatting
-   **Markdown, Latex & Code Highlighting**  
    :scroll: Generate messages with the full power of Markdown and Latex formatting, coupled with syntax highlighting for various programming languages, enhancing readability and presentation.

-   **Prompt Library & Message Quoting**  
    :books: Save and organize prompts for reuse, and quote messages for context in discussions.

### 👥 Collaboration & Sharing
-   **Team Collaboration**  
    :busts_in_silhouette: Collaborate with ease and share OpenAI API resources among your team. [Learn More](./team-sharing/README.md)

### 🌐 Platform Availability
-   **Cross-Platform Desktop**  
    :computer: Chatbox is ready for Windows, Mac, and Linux users.

-   **Web Version**  
    :globe_with_meridians: Use the web application on any device with a browser, anywhere.

-   **Mobile Apps**  
    :phone: Native iOS and Android applications for on-the-go access.

### 🌍 Localization
-   **Multilingual Support**  
    :earth_americas: Catering to a global audience by offering support in multiple languages:
    -   English
    -   简体中文 (Simplified Chinese)
    -   繁體中文 (Traditional Chinese)
    -   日本語 (Japanese)
    -   한국어 (Korean)
    -   Français (French)
    -   Deutsch (German)
    -   Русский (Russian)
    -   Español (Spanish)

### ✨ More Features
-   **And More...**  
    :sparkles: Constantly enhancing the experience with new features!

## FAQ

-   [Frequently Asked Questions](./doc/FAQ.md)

## How to Contribute

We welcome contributions from the community! Here's how you can help make Chatbox better:

### 🐛 Reporting Issues
- Use [GitHub Issues](https://github.com/chatboxai/chatbox/issues) to report bugs or request features
- Before creating a new issue, please search existing issues to avoid duplicates
- Provide detailed information including steps to reproduce, expected behavior, and screenshots if applicable

### 🔧 Pull Requests
1. Fork the repository and create your branch from `main`
2. Make your changes and ensure the code follows our coding standards
3. Test your changes thoroughly
4. Update documentation if needed
5. Submit a pull request with a clear description of the changes

### 🌍 Translations
Help make Chatbox accessible to more people by contributing translations:
- Translation files are located in the `src/locales` directory
- Follow the existing translation format
- Submit a PR with your translation improvements

### 📖 Documentation
- Improve README, API documentation, or user guides
- Fix typos or clarify unclear instructions
- Add examples and tutorials

### 🌟 Other Ways to Contribute
- Star the repository to show your support
- Share Chatbox with others
- Answer questions in [GitHub Discussions](https://github.com/chatboxai/chatbox/discussions)
- Provide feedback and suggestions

**Thank you for contributing! 🙏**

## Development

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v20.x – v22.x) - [Download here](https://nodejs.org/)
- **pnpm** (v10.x or later) - Install via `corepack enable && corepack prepare pnpm@latest --activate`
- **Git** - [Download here](https://git-scm.com/)

### Quick Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/chatboxai/chatbox.git
   cd chatbox
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Start development server**
   ```bash
   pnpm run dev
   ```
   The application will start in development mode with hot-reload enabled.

### Build Commands

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start development server with hot-reload |
| `pnpm run package` | Build and package for current platform |
| `pnpm run package:all` | Build and package for all platforms |
| `pnpm run build` | Build for production without packaging |
| `pnpm run lint` | Run Biome to check code quality |
| `pnpm run test` | Run Vitest test suite |

### Project Structure

```
chatbox/
├── src/
│   ├── main/               # Electron main process
│   ├── renderer/           # React renderer (UI)
│   ├── preload/            # Electron preload scripts
│   └── shared/             # Shared utilities
├── doc/                    # Documentation and assets
├── resources/              # App resources and icons
├── team-sharing/           # Team collaboration features
└── package.json            # Project configuration
```

### Development Tips

- Use `pnpm run lint` before committing to ensure code quality
- Follow the existing code style and patterns
- Test your changes on both light and dark themes
- Ensure cross-platform compatibility when making UI changes

### Troubleshooting

**Issue**: `pnpm install` fails
- **Solution**: Ensure you're using pnpm (not npm or yarn) and Node.js version is within the required range. Run `corepack enable` if pnpm is not found.

**Issue**: Build fails on Windows
- **Solution**: Run `pnpm config set script-shell "C:\\Program Files\\git\\bin\\bash.exe"` if using Git Bash

**Issue**: Changes not reflecting in development
- **Solution**: Stop the dev server, delete `node_modules/.vite`, and restart

## Star History

[![Star History Chart](https://star-history.dera.page/svg?repos=chatboxai/chatbox&type=Date)](https://star-history.dera.page/#chatboxai/chatbox&Date)

## Contact

[Email](mailto:hi@chatboxai.com)

## License

[LICENSE](./LICENSE)
