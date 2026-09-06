# Chatbox Android v490 自动附件策略测试报告

测试日期：2026-09-05

设备：MuMu 模拟器，ADB `192.168.1.102:7555`
包名：`xyz.chatboxapp.chatbox`

## 1. 改动结论

“自动（推荐）”不再按移动端/桌面端分流。所有支持会话附件检索的平台现在执行相同策略：

- 用户强制选择“内联全文”时始终内联。
- 用户强制选择“嵌入检索”时，对支持的文件类型直接使用检索，不受自动阈值影响。
- 自动模式下，解析文本超过 256 KiB 且文件类型适合检索时使用嵌入检索；否则使用内联全文。
- 检索支持类型包括 PDF、Word、PowerPoint、ODT/ODP、EPUB，以及 TXT、Markdown、HTML/XML、JSON/YAML、INI、LOG 等文本资料。
- CSV、Excel 和源代码等需要完整结构/上下文的类型保持内联。
- 没有可用嵌入模型或 Chatbox AI 检索能力时安全回退为内联。
- 超过既有 6 MiB 解析文本安全上限的附件不建立移动索引，并显示大附件警告。

设置说明已同步到全部 14 个 locale。简体中文现在显示：“在所有平台上，对支持的大型附件自动使用嵌入检索；其他附件则以内联全文方式发送解析后的完整文本。”

## 2. 自动化验证

- `sessionHelpers.test.ts`：42/42 项通过；新增移动端自动模式阈值上下边界测试。
- 附件路由、移动索引/模型供应方、设置 Store、设置 schema 和备份共 6 个文件：87/87 项通过。
- 根工程 TypeScript `tsc --noEmit` 通过。
- 14 个 locale JSON 全部可解析。
- `git diff --check` 通过。

新增边界测试明确设置 `platform.type = mobile`、`isDesktopLike = false`：

- 支持的 PDF 解析文本恰好 256 KiB：`ragMode = inline`。
- 同类型解析文本为 256 KiB + 1 byte：`ragMode = session-retrieval`。

因此测试不是依赖桌面平台条件偶然通过。

## 3. APK 制品

| 项目 | 结果 |
|---|---|
| APK | `chatbox-1.23.1-custom-v490-signed.apk` |
| 文件大小 | 38,421,635 bytes |
| SHA-256 | `493f191277babead05bcbb30c89561bdc22c1acd09cd16a981dd40df3d59424f` |
| 版本 | `versionName 1.23.1.490`，`versionCode 490` |
| SDK | minSdk 23，target/compileSdk 35 |
| 签名 | v1/v2/v3 通过，v4 未启用 |
| 签名证书 SHA-256 | `68f4e0a813378e50487565b01a21ffe670466612e172018af4b40775d66c0912` |
| 对齐/压缩 | ZIP 对齐通过；`unzip -t` 无错误 |
| Source map | APK 中 0 个 `.map` |

Android renderer 生产构建成功，共处理 15,815 个 modules。使用 Apktool 3.0.3 `-f` 强制全量重建，随后先对齐、再使用原 P12 证书签名。

## 4. MuMu 验证

- 使用 `adb install -r` 从 v489 覆盖安装 v490，没有卸载或清空数据。
- `dumpsys package` 确认 `versionCode 490`、`versionName 1.23.1.490`；应用“关于”入口同步显示 `1.23.1.490`。
- 原有会话、模型、SearXNG、Skills 和附件模式设置保留。
- 设置页面在自动模式下显示新的跨平台中文策略，不再出现“移动端使用内联全文”。
- MuMu 全局代理仍为 `192.168.1.102:18888`，没有 `adb reverse`。

自动路由实测使用 262,391 bytes 的 Markdown 文件，超过 256 KiB 阈值 247 bytes。附件卡立即进入索引流程，显示“索引 64/656 分块”，直接证明 Android 自动模式选择的是 `session-retrieval`，不再强制内联。

这份夹具来自压缩后的源码，几乎没有自然段，因而被切为 656 个异常细碎分块；用户配置的嵌入服务在完成 64 个分块后拒绝后续请求，最终显示索引失败。本项只能判定“自动路由通过”，不能判定“大型附件完整索引通过”。v488 使用正常 7 分块文档时，Android 嵌入和重排序端到端均已成功。发布前仍建议另用结构正常、刚超过阈值的真实文档测试供应端限流与长时间索引。

测试结束后已删除模拟器 Download 中的两个测试文件；失败附件只存在于未发送的新会话草稿，强制停止和冷启动后已清除。最终启动页面只显示用户原有会话。最终 logcat 没有 FATAL、`TypeError`、`ReferenceError`、错误边界或 `getSettings is not a function`。

## 5. 截图索引

- `01-cold-start.png`：v490 覆盖安装后的首次冷启动。
- `02-auto-policy-settings.png`：自动模式的新中文说明、嵌入及重排序模型仍保留。
- `10-auto-large-md-later.png`：Android 自动模式进入大型 Markdown 索引，并显示 64/656 分块进度及供应端失败。
- `12-final-clean-start.png`：测试文件和草稿清理后的最终冷启动，版本号为 1.23.1.490。
