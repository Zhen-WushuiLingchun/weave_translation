# 织语 Weave

织语是一款本地优先的 Chrome 智能翻译扩展。它使用你自己的 DeepSeek 或 OpenAI-compatible API，在网页、划词和 YouTube/Bilibili 字幕中共享页面摘要、相邻内容与术语上下文。

## 首版能力

- 所有普通网页可见、左右吸附并自动收回的侧边坞
- 原文 / 双语 / 译文三种整页模式，视口优先、支持动态页面
- 带段落和标题上下文的划词翻译及语境解释；翻译卡片可拖动并受视口边界约束
- YouTube、Bilibili 现有字幕读取、语义重组、双语覆盖与提前翻译
- DeepSeek 预设、任意 Chat Completions 兼容地址、本地模型地址
- 兼容 / 快速 / 均衡 / 深入四档推理控制，并按 DeepSeek 或 OpenAI 格式转换参数
- 无账户、无会员、无遥测；密钥不进入页面脚本和 Git

首版不包含无字幕 ASR、OCR、PDF/电子书、云同步或移动端。

## 开发

要求 Node.js 20+ 和 pnpm。

```powershell
pnpm install
pnpm dev
```

生产构建与完整检查：

```powershell
pnpm check
pnpm zip
```

构建结果位于 `.output/chrome-mv3/`。也可以在 `chrome://extensions` 开启开发者模式后，选择“加载已解压的扩展程序”并指向该目录。

## 首次使用

1. 在欢迎页主动授予普通网页访问权限；如果拒绝，可通过工具栏仅在当前页启用。
2. 打开设置，在“模型服务”中选择 DeepSeek 或填写完整 OpenAI-compatible Chat Completions 地址。
3. 填写 API Key、模型名和思考强度并执行“保存并测试”。本地服务可以留空 Key；旧模型不接受推理参数时使用“兼容模式”。
4. 在任意普通网页右侧展开“织语”把手，按需翻译页面或调整站点规则。
5. 在 YouTube/Bilibili 使用已有字幕的视频中开启字幕翻译；YouTube 若未发现字幕轨，先开启一次原生 CC。

## 安全边界

- 安装时不强制申请全站权限；欢迎页中的按钮会触发 Chrome 官方权限提示。
- API Key 存在 `chrome.storage.local` 或 `chrome.storage.session`，并限制为可信扩展上下文读取。
- Chrome 本地扩展存储不是操作系统级加密保险箱；更敏感的密钥应选择“仅本次浏览器会话”。
- 内容脚本不会收到密钥，不采集密码框、输入区、编辑器、代码块和隐藏节点。
- 只有用户主动翻译或站点自动规则生效时，网页文本才会发送到所配置的模型地址。

## 许可

本项目以 [Apache License 2.0](LICENSE) 发布。第三方设计参考和固定版本见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
