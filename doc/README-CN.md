<p align="right">
  <a href="../README.md">English</a> |
  <a href="README-CN.md">简体中文</a>
</p>

这里是 Chatbox 社区版的代码仓库，以 GPLv3 许可证开源。

[Chatbox 再次开源！](https://github.com/chatboxai/chatbox/issues/2266)

我们定期从专业版仓库同步代码到这个仓库，反之亦然。

## ghoulich Android 二开版

本 fork 以官方 Chatbox `v1.23.1` 为基线，当前二开版本为
`1.23.1.495`。在保留上游桌面端和 Web 代码的同时，Android 端增加：

- 通过 Android SAF 只读扫描 Skills，在对话中调用 `load_skill`，并在
  Android 对话模式中启用 Skills 与远程 HTTP/SSE MCP；
- 支持认证和引擎选择的 SearXNG 网页、图片、视频搜索；明确的图片请求会
  强制路由到图片搜索，即使模型遗漏或改写媒体地址，也会通过兜底图库/卡片
  保留图片预览和来源链接；视频缩略图会区分应用内可播放视频与只能打开网页
  的视频；
- 网页读取可选择 Chatbox 原生 `parse_link` 或自托管 Firecrawl；Firecrawl
  支持可选 Bearer Token、受限超时、Android 原生 HTTP 传输，并提供默认关闭
  的原生读取回退开关；
- 原生接入自托管 ComfyUI 生图：支持端点及可选 Basic Auth 用户名/密码、API 工作流导入、
  标准节点自动识别、显式参数映射、检查点模型发现、轮询/取消，以及把结果下载
  到本地图像历史；可设置默认生图模型，同时保留原有云端生图提供方；
- 新会话 Soul/人格注入，以及不会覆盖用户手动命名的搭档会话自动标题；
- DNS、Ping、TCP、HTTP/TLS、Wi-Fi/LAN、限流测速、SSH 和只读 SNMP 等
  Android 本地网络诊断，敏感凭据不会出现在模型可见的工具结果中；
- 前台服务辅助的后台生成、隐私通知、受限 wake lock，以及后台开关触发的
  Settings Store 崩溃修复；
- Mermaid 图表支持自适应明暗模式的现代主题、语义配色、优化间距与精致容器；
  沙箱化 Three.js 教学动图支持真全屏、触摸旋转/平移/双指缩放、离线 KaTeX
  字体、生命周期清理和精确安全规则；
- 会话附件可选择内联全文或嵌入检索及重排；自动模式统一按文件类型和大小
  决策；移动索引支持批次退避重试、持久化检查点和断点续传；
- Android 文档导出、用户 CA（仍校验主机名）、移动界面修复，以及全部二开
  UI 文本在内置 14 种语言中的翻译。

官方 `v1.23.1` 快照不包含完整的 Capacitor Android 工程。本项目当前通过
[`custom/android`](../custom/android) 中维护的覆盖文件和仓库外单独保存的
已验证壳组装 APK。签名证书、口令、APK、私人模型/搜索配置和应用数据库不会
提交到仓库。实现说明见 [`custom/android/README.md`](../custom/android/README.md)，
最新设备测试见
[`test-evidence/mumu-v492/TEST_REPORT.md`](../test-evidence/mumu-v492/TEST_REPORT.md)。

### Firecrawl 配置

打开“**设置 → 联网搜索 → 网页读取器**”，选择 **Firecrawl**，填写自托管
服务的基础地址（例如 `https://firecrawl.example.com`）。仅在服务需要鉴权时
填写 Bearer Token，选择超时时间后点击“**检查连接**”发起一次真实抓取测试。
只有在允许 Firecrawl 失败后由 Android 设备直接读取目标网页时，才启用
“**失败时回退到原生读取**”；保持关闭可确保网页读取流量不回退到手机端。

### ComfyUI 配置

打开“**设置 → ComfyUI 图像生成**”，填写 ComfyUI 或带身份认证反向代理的基础
地址；仅在服务需要时填写 Basic Auth 用户名和密码。在 ComfyUI 中使用 **Save (API Format)**
导出工作流并导入 JSON。标准的检查点、提示词、采样器和潜空间图像节点会自动
识别；自定义工作流可用“`节点ID.输入名`”显式映射。点击“**检查 ComfyUI 连接**”
验证后，还可到“**设置 → 默认模型 → 默认图像生成模型**”选择默认检查点。

工作流中的宽、高为有效数值或节点连线时优先使用；设置里的默认宽、高只补齐
缺失、为零或无效的工作流输入。选择 ComfyUI 后，生图页面不再显示容易产生
歧义的通用宽高比选择器，最终尺寸由工作流及上述默认值共同决定。

Android 端到端测试使用的最小 SD 1.5 API 工作流见
[`custom/android/comfyui-workflows/sd15-basic-api.json`](../custom/android/comfyui-workflows/sd15-basic-api.json)。

第二阶段的工作流同步桥接器位于
[`custom/comfyui-workflow-bridge`](../custom/comfyui-workflow-bridge)。它在 ComfyUI
的用户隔离目录中成对保存可编辑 UI-format 和可执行 API-format，无需向公网开放
范围更大的 `/userdata` 接口；构建校验、宿主机挂载/K8S 安装、Ingress、升级和
卸载方式见扩展目录内的 README。

### 下载电脑端

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
        <img src='./statics/windows.png' style="height:24px; width: 24px" />
        <br />
        <b>Setup.exe</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-mac-intel'>
        <img src='./statics/mac.png' style="height:24px; width: 24px" />
        <br />
        <b>Intel</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-mac-aarch'>
        <img src='./statics/mac.png' style="height:24px; width: 24px" />
        <br />
        <b style="white-space: nowrap;">Apple Silicon</b>
      </a>
    </td>
    <td align="center" valign="middle">
      <a href='https://chatboxai.app/?c=download-linux'>
        <img src='./statics/linux.png' style="height:24px; width: 24px" />
        <br />
        <b>AppImage</b>
      </a>
    </td>
  </tr>
</table>

### 下载移动端

<a href='https://apps.apple.com/app/chatbox-ai/id6471368056' style='margin-right: 4px'>
<img src='./statics/app_store.webp' style="height:38px;" />
</a>
<a href='https://play.google.com/store/apps/details?id=xyz.chatboxapp.chatbox' style='margin-right: 4px'>
<img src='./statics/google_play.png' style="height:38px;" />
</a>
<a href='https://chatboxai.app/zh/install?download=android_apk' style='margin-right: 4px; display: inline-flex; justify-content: center'>
<img src='./statics/android.png' style="height:28px; display: inline-block" />
.APK
</a>

更多信息请访问: [chatboxai.app](https://chatboxai.app/)

---


<h1 align="center">
<img src='./statics/icon.png' width='30'>
<span>
    Chatbox
    <span style="font-size:8px; font-weight: normal;">(Community Edition)</span>
</span>
</h1>
<p align="center">
    <em>Chatbox 是一个 AI 模型桌面客户端，支持 ChatGPT、Claude、Google Gemini、Ollama 等主流模型，适用于 Windows、Mac、Linux、Web、Android 和 iOS 全平台</em>
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
<img alt="下载量" src="https://img.shields.io/github/downloads/chatboxai/chatbox/total.svg?style=flat" />
</a>
<a href="https://twitter.com/benn_huang" target="_blank">
<img alt="Twitter" src="https://img.shields.io/badge/关注-benn_huang-blue?style=flat&logo=Twitter" />
</a>
</p>

<a href="https://www.producthunt.com/posts/chatbox?utm_source=badge-featured&utm_medium=badge&utm_souce=badge-chatbox" target="_blank"><img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=429547&theme=light" alt="Chatbox - Better&#0032;UI&#0032;&#0038;&#0032;Desktop&#0032;App&#0032;for&#0032;ChatGPT&#0044;&#0032;Claude&#0032;and&#0032;other&#0032;LLMs&#0046; | Product Hunt" style="width: 150px; height: 30px;" width="100" height="40" /></a>

<img src="./statics/demo_desktop_1.jpg" alt="应用截图" style="box-shadow: 2px 2px 10px rgba(0,0,0,0.1); border: 1px solid #ddd; border-radius: 8px; width: 700px" />

<img src="./statics/demo_desktop_2.jpg" alt="应用截图" style="box-shadow: 2px 2px 10px rgba(0,0,0,0.1); border: 1px solid #ddd; border-radius: 8px; width: 700px" />

## 特性

-   **本地数据存储**  
    :floppy_disk: 您的数据保留在您的设备上，确保数据永不丢失并保护您的隐私。

-   **无需部署、直接安装的安装包**  
    :package: 通过可下载的安装包快速开始使用。无需复杂设置！

-   **支持多个 LLM 提供商**  
    :gear: 无缝集成多种 AI 模型：

    -   OpenAI (ChatGPT)
    -   Azure OpenAI
    -   Claude
    -   Google Gemini Pro
    -   Ollama (启用对本地模型的访问，如 llama2、Mistral、Mixtral、codellama、vicuna、yi 和 solar)
    -   ChatGLM-6B

-   **使用 Dall-E-3 生成图像**  
    :art: 使用 Dall-E-3 创建您想象中的图像。

-   **增强提示**  
    :speech_balloon: 高级提示功能，精炼并聚焦您的查询以获得更好的响应。

-   **键盘快捷键**  
    :keyboard: 使用加速您工作流程的快捷键保持高效。

-   **Markdown、Latex 和代码高亮**  
    :scroll: 使用 Markdown 和 Latex 的全部功能生成消息，并结合各种编程语言的语法高亮，提高可读性和呈现效果。

-   **提示库和消息引用**  
    :books: 保存和组织提示以供重复使用，并引用消息以在讨论中提供上下文。

-   **流式回复**  
    :arrow_forward: 通过即时、渐进式回复快速响应您的互动。

-   **人体工程学 UI 和深色主题**  
    :new_moon: 用户友好的界面，带有夜间模式选项，减少长时间使用时的眼睛疲劳。

-   **团队协作**  
    :busts_in_silhouette: 轻松协作并在团队中共享 OpenAI API 资源。[了解更多](../team-sharing/README.md)

-   **跨平台可用性**  
    :computer: 聊天盒已为 Windows、Mac、Linux 用户准备就绪。

-   **通过 Web 版本随处访问**  
    :globe_with_meridians: 在任何设备上使用带有浏览器的 Web 应用程序，随时随地。

-   **iOS 和 Android**  
    :phone: 使用移动应用程序，随时随地在您的指尖上带来这种能力。

-   **多语言支持**  
    :earth_americas: 通过提供多种语言的支持，迎合全球受众：

    -   English
    -   简体中文 (Simplified Chinese)
    -   繁體中文 (Traditional Chinese)
    -   日本語 (Japanese)
    -   한국어 (Korean)
    -   Français (French)
    -   Deutsch (German)
    -   Русский (Russian)

-   **更多...**  
    :sparkles: 不断增强体验，加入新功能！

## 常见问题解答

-   [常见问题](./FAQ-CN.md)

## 如何贡献

欢迎任何形式的贡献，包括但不限于：

-   提交问题
-   提交拉取请求
-   提交功能请求
-   提交错误报告
-   提交文档修订
-   提交翻译
-   提交任何其他形式的贡献

## 构建指南

1. 从 Github 克隆仓库

```bash
git clone https://github.com/chatboxai/chatbox.git
```

2. 安装所需的依赖

```bash
npm install
```

3. 启动应用程序（开发模式）

```bash
npm run dev
```

4. 构建应用程序，为当前平台打包安装程序

```bash
npm run package
```

5. 构建应用程序，为所有平台打包安装程序

```bash
npm run package:all
```

## Star History

[![星星历史图表](https://star-history.dera.page/svg?repos=chatboxai/chatbox&type=Date)](https://star-history.dera.page/#chatboxai/chatbox&Date)

## 联系方式

[Twitter](https://x.com/ChatboxAI_HQ) | [电子邮件](mailto:hi@chatboxai.com)
