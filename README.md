<div align="center">
  <img src="./public/icon-128.png" width="96" height="96" alt="织语 Weave 图标">
  <h1>织语 Weave</h1>
  <p>使用自己的 AI 模型，在网页、划词与视频字幕中获得有上下文的自然翻译。</p>
  <p>
    <img alt="Version 0.4.0" src="https://img.shields.io/badge/version-0.4.0-E85D4A">
    <img alt="Chrome Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-2A7F78">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178C6">
    <img alt="Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-111820">
  </p>
</div>

织语是一款本地优先的 Chrome 智能翻译扩展。它不要求注册账户，也没有会员或自建中转服务器；你可以配置多个 DeepSeek 或 OpenAI-compatible 云端及本地模型，并为不同任务和网站独立选择。

> 当前项目处于早期测试阶段。建议先在非敏感网页中试用，并留意模型服务商产生的 API 费用。

## 功能概览

### 网页翻译

- 原文、双语对照、仅译文三种显示模式，译文以独立节点插入，不覆盖原始 DOM。
- 视口内容优先翻译，并通过 `IntersectionObserver` 与 `MutationObserver` 处理 SPA、无限滚动和延迟加载内容。
- 翻译前提取页面主题摘要、标题路径、相邻段落和术语候选，减少歧义并保持全文用词一致。
- 支持论文公式与受限 Markdown 输出，公式处理按数学语义格式工作，不绑定 arXiv 或其他单一站点。
- 自动排除密码框、表单控件、编辑器、代码块、隐藏节点和扩展自身界面。
- 自动识别网页深浅色背景，也可以全局或按站点强制使用浅色、深色译文主题。
- `Alt+Shift+W` 快速开始或停止整页翻译。

### 论文与公式翻译

- 识别原生 MathML（包括 arXiv HTML）、KaTeX、MathJax、`role="math"`、`data-tex` 与 `data-latex`。
- 内联公式会被替换为不可改写的稳定占位符，同时将对应 LaTeX 提供给模型；返回后由扩展在原位置安全恢复。
- 独立块公式和公式编号不会生成重复译文框。它们的 LaTeX 会以只读 `contextMath` 关联到前后最近段落，使模型能够理解“由上式”“该度规”等引用。
- 模型输出只允许受限 Markdown、行内 LaTeX 和块级 LaTeX；扩展使用本地 KaTeX 转换为 MathML，不执行模型返回的 HTML、脚本、样式或远程资源。
- 如果公式只有图片、Canvas，或没有 LaTeX、MathML、无障碍文本的纯 SVG，织语会保留原始公式与页面排版，但不会猜测公式内容。此类内容需要后续 OCR 或视觉模型支持。
- 模型遗漏、重复或伪造公式占位符时，该段译文不会写入页面，原文保持不变，并可从侧边坞重试。

### 划词翻译

- 选中文本后显示轻量圆点，点击即打开翻译卡片并立即反馈“正在翻译”。
- 卡片可拖动，位置始终限制在当前视口内，方便边阅读边对照。
- 首轮请求包含所在段落、相邻内容和最近的标题层级。
- 可继续请求“解释语境”，用于辨析词义、指代和专业术语。

### YouTube / Bilibili 字幕翻译

- 读取视频已有字幕，不修改播放器原生行为。
- 将碎片字幕按标点、停顿、说话人变化、持续时间和长度重新组合成语义句。
- 在独立字幕层中显示原文 + 译文或仅译文，并可调节字号、底部位置和背景透明度。
- 播放时预取当前位置之后的字幕；拖动进度条后重新调度附近内容。
- YouTube 若尚未发现字幕轨，需要先开启一次播放器原生 CC。
- 当前视频没有字幕时，可由用户点击“生成并翻译字幕”，边播放边调用云端或本机 OpenAI-compatible Audio Transcriptions 服务。
- ASR 使用约 3–15 秒的语音活动分片、重叠去重与时间映射；暂停和拖动进度后会重新同步。
- 标签页音频权限只在用户启动 ASR 时申请，原始音频分片处理后立即释放，不持久保存。

### 侧边坞

- 在普通 `http/https` 网页中默认显示，点击把手才展开，避免悬停误触。
- 可上下拖动、吸附左右边缘并跨页面保存位置。
- 折叠时只有可见把手响应点击；展开后可固定，也可离开后自动收回。
- 使用独立 Shadow DOM、原生顶层栈与最高层级保护，尽量避免被网页弹层或全屏容器遮挡。
- 可直接切换翻译模式、目标语言、思考强度、主题与本站自动翻译，也可以暂停或隐藏当前站点。

## 多模型、任务路由与思考强度

织语将配置拆分为“服务连接”和“模型配置”。一个连接保存接口与密钥，多个模型可以复用该连接；模型会声明聊天、工具调用、语音识别和推理强度能力。远程接口必须使用 HTTPS；`localhost`、`127.0.0.1` 和 `[::1]` 可使用 HTTP。

任务路由可分别设置网页摘要、整页翻译、划词翻译、语境解释、视频摘要、字幕翻译和语音识别。网页侧边坞中的临时切换只影响当前标签页，优先级为：当前标签页临时模型 → 站点档案模型 → 任务默认模型。

网页、划词和字幕可以分别选择思考强度：

| 模式 | 适用场景 | 行为 |
| --- | --- | --- |
| 兼容 | 不接受推理参数的旧模型或特殊接口 | 不发送推理强度参数 |
| 快速 | 划词、实时字幕、简单网页 | 优先降低等待时间 |
| 均衡 | 普通文章和大多数整页翻译 | 兼顾速度与上下文 |
| 深入 | 论文、技术文档、复杂歧义 | 请求更高推理强度，耗时和费用可能增加 |

不同提供商对推理参数的支持并不完全一致。如果接口返回参数错误，请改用“兼容”模式；具体可用模型与计费规则以你的模型服务商为准。

## 专业术语库

- 词典完全保存在本机 IndexedDB，可按全局、主域名及精确主机名限定范围。
- 翻译前先进行确定性原词/别名匹配，只把当前文本实际命中的紧凑词条发送给模型。
- “混合检索”允许支持工具调用的模型执行一次 `lookup_glossary`；完整词典不会进入模型上下文。
- 模型发现新术语时只能添加到“待确认”列表，由用户确认后才会启用。
- 设置页支持 CSV/JSON 导入、冲突确认及 CSV/JSON 导出。

## 站点翻译档案

你可以为不同网站保存独立规则，覆盖自动翻译、页面模式、目标语言、网页思考强度和译文主题。

| 规则 | 匹配范围 |
| --- | --- |
| `example.com` | 主域名、全部路径及任意层级子域名，例如 `docs.example.com/a/b` |
| `docs.example.com` | `docs.example.com` 及其更深层子域名；比 `example.com` 更具体 |

当多条规则同时命中时，更具体的精确域名规则会覆盖通配规则。仅显示侧边坞不会产生模型请求；只有手动触发翻译或命中的站点档案启用了自动翻译时，才会发送经过过滤的文本。

## 安装测试版

### 从源码构建

环境要求：Chrome 116+、Node.js 20+、pnpm 11。

```powershell
git clone https://github.com/Zhen-WushuiLingchun/weave_translation.git
cd weave_translation
corepack enable
pnpm install --frozen-lockfile
pnpm build
```

然后在 Chrome 中：

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择项目中的 `.output/chrome-mv3/` 目录。

修改代码后可运行 `pnpm dev` 进入 WXT 开发模式。生成可分发 ZIP 使用：

```powershell
pnpm zip
```

产物位于 `.output/`。该目录是本地构建结果，不提交到 Git。

如果已经通过“加载已解压的扩展程序”安装过织语，重新构建后请进入 `chrome://extensions`，在织语卡片上点击“重新加载”，并刷新正在测试的网页。直接覆盖 `.output/chrome-mv3/` 中的文件不会自动更新已打开页面里的内容脚本。

生产构建还会检查所有扩展文本产物是否为 Chrome 可接受的 UTF-8，并拒绝 Unicode 非字符，避免依赖打包后导致内容脚本无法加载。

## 首次配置

1. 安装后打开“服务与模型”，添加 DeepSeek 或 OpenAI-compatible 服务连接。
2. 填写完整 Chat Completions 地址与 API Key；本地无鉴权服务可以留空 Key。
3. 为连接新增一个或多个模型，并勾选该模型实际支持的能力。
4. 在“任务路由”中为网页、划词、解释、字幕和 ASR 分配模型与思考强度。
5. 打开任意普通网页，点击页面边缘的“织”字把手开始使用。

无字幕视频需要额外配置完整的 `/audio/transcriptions` 地址和具备 `audioTranscription` 能力的模型。使用本机 faster-whisper 的方法见 [本地 ASR 配置](docs/local-asr.md)。

默认源语言为自动识别，目标语言为简体中文；目标语言可改为繁体中文、英语、日语或韩语。

## 数据与安全边界

- 每个连接的持久 API Key 按独立 `secretRef` 保存在 `chrome.storage.local`，会话 Key 保存在 `chrome.storage.session`，并限制为可信扩展上下文读取。
- 内容脚本只会收到“是否已配置密钥”的状态，不会收到密钥明文。
- 日志、翻译缓存键和配置导出不包含 API Key。
- Chrome 扩展本地存储不是操作系统级加密保险箱；共享账户或高风险设备建议使用会话模式。
- 扩展不收集遥测，不上传浏览历史，不加载远程可执行代码。
- 安装时申请普通网页访问权限，用于显示侧边坞和在用户触发后读取可翻译文本；Chrome 内部页与 Chrome Web Store 等受保护页面无法注入。
- `tabCapture` 是可选权限，只在用户点击无字幕生成时申请；音频进入内存分片后发送到用户配置的转录服务，不写入磁盘或 IndexedDB。
- 发送给模型的内容取决于所选功能：整页翻译会发送摘要样本和文本批次，划词会发送选中内容及邻近语境，字幕翻译会发送视频标题、字幕样本和当前时间附近的句子。

更完整的数据流说明见 [SECURITY.md](SECURITY.md)。请勿在 Issue、日志或截图中公开真实 API Key 与敏感网页内容。

## 开发与验证

```powershell
# 类型检查、单元测试和生产构建
pnpm check

# 无界面持久化 Chromium 扩展端到端测试（PowerShell）
$env:WEAVE_E2E='1'
$env:WEAVE_E2E_HEADLESS='1'
pnpm test:e2e

# 仅运行单元测试
pnpm test
```

当前共有 56 项 Vitest 测试，覆盖上下文与 DOM、公式保护、字幕断句、多模型路由、v1→v2 迁移、密钥隔离、词典检索、工具调用、PCM/WAV、VAD、重叠去重、转录响应、重试与日志边界。Playwright 使用持久化 Chromium 验证扩展安装、Manifest 权限、模型配置、站点规则、公式、侧边坞、整页翻译和划词链路。

## 项目结构

```text
src/
├─ background/             # 模型/ASR 调用、路由、术语库、缓存与密钥
├─ content/                # 上下文、网页翻译、悬浮层与视频控制
│  └─ subtitles/           # YouTube/Bilibili 适配与字幕断句
├─ entrypoints/            # MV3 后台、内容脚本、Offscreen、设置与弹窗
├─ lib/                    # 数据契约、音频、词典、默认值与站点规则
└─ ui/                     # 共享视觉基础
tests/                     # Vitest 与 Playwright 测试
public/                    # 本地图标资源
```

技术栈：WXT、TypeScript、React、Chrome Manifest V3、Vitest、Playwright。所有扩展脚本与视觉资源均在本地打包。

## 当前边界

当前版本不包含：

- 任意 HTML5 视频或会议标签页的通用 ASR（当前正式支持 YouTube/Bilibili）
- 下载完整媒体并预先识别尚未播放的音频
- 捆绑的 Windows faster-whisper 服务程序
- OCR 图片翻译
- PDF / 电子书专用解析
- 云同步、用户账户或团队术语库
- Firefox、Safari 与移动端正式支持

## 贡献与许可

欢迎通过 Issue 提交可复现的问题或功能建议。涉及新平台字幕适配、模型提供商或页面注入逻辑的修改，请同时补充测试，并避免提交 API Key、Cookies、字幕签名地址或私密页面夹具。

本项目以 [Apache License 2.0](LICENSE) 发布。发行构建所使用的开源依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
