<div align="center">
  <img src="./public/icon-128.png" width="96" height="96" alt="织语 Weave 图标">
  <h1>织语 Weave</h1>
  <p>使用自己的 AI 模型，在网页、划词与视频字幕中获得有上下文的自然翻译。</p>
  <p>
    <img alt="Version 0.3.0" src="https://img.shields.io/badge/version-0.3.0-E85D4A">
    <img alt="Chrome Manifest V3" src="https://img.shields.io/badge/Chrome-Manifest%20V3-2A7F78">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178C6">
    <img alt="Apache 2.0" src="https://img.shields.io/badge/license-Apache--2.0-111820">
  </p>
</div>

织语是一款本地优先的 Chrome 智能翻译扩展。它不要求注册账户，也没有会员或自建中转服务器；你可以直接连接 DeepSeek，或任意兼容 OpenAI Chat Completions 的云端及本地模型服务。

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
- 当前视频没有字幕时会明确提示；首版不包含 ASR 语音识别。

### 侧边坞

- 在普通 `http/https` 网页中默认显示，点击把手才展开，避免悬停误触。
- 可上下拖动、吸附左右边缘并跨页面保存位置。
- 折叠时只有可见把手响应点击；展开后可固定，也可离开后自动收回。
- 使用独立 Shadow DOM、原生顶层栈与最高层级保护，尽量避免被网页弹层或全屏容器遮挡。
- 可直接切换翻译模式、目标语言、思考强度、主题与本站自动翻译，也可以暂停或隐藏当前站点。

## 自带 API 与思考强度

织语提供 DeepSeek 预设，也接受完整的 OpenAI-compatible Chat Completions 地址、模型名称和可为空的 Bearer Key。远程接口必须使用 HTTPS；`localhost`、`127.0.0.1` 和 `[::1]` 可使用 HTTP。

网页、划词和字幕可以分别选择思考强度：

| 模式 | 适用场景 | 行为 |
| --- | --- | --- |
| 兼容 | 不接受推理参数的旧模型或特殊接口 | 不发送推理强度参数 |
| 快速 | 划词、实时字幕、简单网页 | 优先降低等待时间 |
| 均衡 | 普通文章和大多数整页翻译 | 兼顾速度与上下文 |
| 深入 | 论文、技术文档、复杂歧义 | 请求更高推理强度，耗时和费用可能增加 |

不同提供商对推理参数的支持并不完全一致。如果接口返回参数错误，请改用“兼容”模式；具体可用模型与计费规则以你的模型服务商为准。

## 站点翻译档案

你可以为不同网站保存独立规则，覆盖自动翻译、页面模式、目标语言、网页思考强度和译文主题。

| 规则 | 匹配范围 |
| --- | --- |
| `example.com` | `example.com` 下的所有路径，例如 `example.com/a/b`；不匹配子域名 |
| `*.example.com` | `example.com` 本身及任意层级子域名，例如 `docs.example.com` |

当多条规则同时命中时，更具体的精确域名规则会覆盖通配规则。仅显示侧边坞不会产生模型请求；只有手动触发翻译或命中的站点档案启用了自动翻译时，才会发送经过过滤的文本。

## 安装测试版

### 从源码构建

环境要求：Chrome 114+、Node.js 20+、pnpm 11。

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

1. 安装后打开织语设置页，在“模型服务”中选择 DeepSeek 或 OpenAI-compatible。
2. 填写完整 Chat Completions 地址、模型名称和 API Key；本地无鉴权服务可以留空 Key。
3. 选择持久保存或仅本次浏览器会话保存，然后点击“保存并测试”。
4. 分别为网页、划词和视频字幕设置思考强度。
5. 打开任意普通网页，点击页面边缘的“织”字把手开始使用。

默认源语言为自动识别，目标语言为简体中文；目标语言可改为繁体中文、英语、日语或韩语。

## 数据与安全边界

- 持久 API Key 保存在 `chrome.storage.local`，会话 Key 保存在 `chrome.storage.session`，并限制为可信扩展上下文读取。
- 内容脚本只会收到“是否已配置密钥”的状态，不会收到密钥明文。
- 日志、翻译缓存键和配置导出不包含 API Key。
- Chrome 扩展本地存储不是操作系统级加密保险箱；共享账户或高风险设备建议使用会话模式。
- 扩展不收集遥测，不上传浏览历史，不加载远程可执行代码。
- 安装时申请普通网页访问权限，用于显示侧边坞和在用户触发后读取可翻译文本；Chrome 内部页与 Chrome Web Store 等受保护页面无法注入。
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

当前共有 43 项 Vitest 测试，覆盖上下文窗口、DOM 排除、MathML/KaTeX/MathJax 提取、LaTeX 占位契约、块公式上下文、受限 Markdown 渲染、字幕断句与时间映射、站点规则、主题识别、悬浮层位置、模型响应映射、重试和密钥存储迁移。Playwright 使用持久化 Chromium 环境，通过本地模拟模型服务验证扩展加载、公式元数据确实到达模型、块公式不生成重复译文以及完整页面翻译链路。

## 项目结构

```text
src/
├─ background/             # 模型调用、重试、缓存与密钥存储
├─ content/                # 上下文、网页翻译、悬浮层与视频控制
│  └─ subtitles/           # YouTube/Bilibili 适配与字幕断句
├─ entrypoints/            # MV3 后台、内容脚本、设置、引导与弹窗
├─ lib/                    # 数据契约、默认值、推理和站点规则
└─ ui/                     # 共享视觉基础
tests/                     # Vitest 与 Playwright 测试
public/                    # 本地图标资源
```

技术栈：WXT、TypeScript、React、Chrome Manifest V3、Vitest、Playwright。所有扩展脚本与视觉资源均在本地打包。

## 当前边界

首版不包含：

- 无字幕视频的 ASR
- OCR 图片翻译
- PDF / 电子书专用解析
- 云同步、用户账户或团队术语库
- Firefox、Safari 与移动端正式支持

## 贡献与许可

欢迎通过 Issue 提交可复现的问题或功能建议。涉及新平台字幕适配、模型提供商或页面注入逻辑的修改，请同时补充测试，并避免提交 API Key、Cookies、字幕签名地址或私密页面夹具。

本项目以 [Apache License 2.0](LICENSE) 发布。发行构建所使用的开源依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
