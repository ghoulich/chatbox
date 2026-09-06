# Chatbox Android v492 搜索与图表回归报告

## 环境

- 日期：2026-09-06
- 设备：MuMu 模拟器，ADB `192.168.1.102:7555`
- 包名：`xyz.chatboxapp.chatbox`
- 版本：`versionName 1.23.1.492`，`versionCode 492`
- APK：`chatbox-1.23.1-custom-v492-signed.apk`
- APK SHA-256：`9838d6946f8c0587808008fc0e18eebe3e8af8aeec5e95a911be9fa278109e27`

测试使用模拟器中已有的模型、SearXNG、Skills 和 Firecrawl 配置。报告不记录
Bearer Token、模型密钥、签名口令或其他私密配置。

## 结果

| 项目 | 结果 | 观察 |
| --- | --- | --- |
| 覆盖安装与版本 | 通过 | 保留应用数据覆盖安装，关于页和 `dumpsys package` 均显示 `1.23.1.492`。 |
| Firecrawl 连接检查 | 通过 | “设置 → 联网搜索 → 网页读取器”选择 Firecrawl 后，真实抓取 `https://example.com` 显示“连接成功”。 |
| 会话网页读取 | 通过 | 会话依次调用 SearXNG 联网搜索和“解析链接”，读取 Firecrawl 官方文档并返回首个标题“快速开始”；解析步骤约 4.5 秒。 |
| 图片搜索路由 | 通过 | 明确的药盒图片请求调用“图片搜索”，没有替换成普通网页搜索。 |
| 图片回答展示 | 通过 | 回答直接显示药盒缩略图和“打开来源”；外站媒体加载失败的结果保留来源卡片，没有退化成裸链接。 |
| Mermaid 渲染 | 通过 | 架构图以 Mermaid SVG 渲染，深色模式下显示蓝黑分层背景、紫色服务节点、绿色数据节点和高对比连线。 |
| 冷启动与设置持久化 | 通过 | 强制停止并重新启动后应用正常；Firecrawl 选择、端点、遮罩 Token、120 秒超时及回退开关均保留。 |
| 错误日志 | 通过 | 未发现应用 FATAL、`getSettings is not a function`、前端 TypeError、Mermaid 安全错误或 SecurityError。 |

Firecrawl 回归时模拟器原有的“失败时回退到本机网页读取”开关处于开启状态；
测试没有故意破坏可用服务。严格禁止回退的失败分支由自动化测试覆盖：关闭开关
时 Firecrawl 失败会直接返回错误，不会调用原生网页读取器。

回归创建的“Firecrawl文档解析”“康可药盒图片搜索”和“云服务架构图”会话已在
取证后删除，没有修改或删除用户原有会话与配置。
