# 项目长期记忆：myInterviewQuestion

## 项目目标
把一份本地题库 PDF，转成可在手机上翻卡复习的题目卡片。用户是备考者本人，痛点是「PDF 里的题目没法一道一道地刷」。

**用户设备：只用 iPhone。** 所有兼容性决策以此为前提。

## 架构（2026-09-29 已变更，以本节为准）
**前端：手机 H5 网页。后端：WorkBuddy 云服务**（数据库 + 用户认证 + 文件存储）。
> 最初曾定为「纯本地、无后端，数据存浏览器」，后因用户明确表示「这个肯定是有服务端的」而改为前后端架构。**凡见到旧的「无后端 / 存本地」描述，一律以此节为准。**

- 云服务**已开通**：applicationId `wbapp_o7AapivIxLQCXzwxNNvNVa`，应用名「面试题背诵」，billingStatus `normal` / provisionStatus `assigned`。
- `publicConfig`（endpoint / publishableKey）**刻意不落盘保存**；需要时重新 inspect / activate 获取即可（幂等，不会重复计费）。
- 写任何云相关代码前，**必须先加载 `cloud-service` skill**，并按其 `references/<module>/code-generation.md` 写。禁止凭记忆写 SDK 调用（SDK 不是 cloudbase-js-sdk，也不是 supabase）。

## 已确认的需求决策
| 维度 | 结论 |
|---|---|
| 形态 | 手机 H5 网页 + 云服务后端（免安装，扫码/链接打开） |
| 题目来源 | 用户自己提供题库 PDF，按实际排版定解析规则 |
| 卡片形式 | **题答同屏**（题目和答案一起显示，不翻面） |
| 背诵顺序 | 顺序背（保留原序，含层层递进题目）+ 随机背（打乱抽查） |
| 进度 | 记住背到哪一题；**存云端、跟账号走，可跨设备继续** |
| 复习模式 | 答案隐藏 → 对着题目**开口讲并录音** → 点开答案自己对照；同样支持顺序/随机 |
| 录音 | 复习时录音 + 可回放；**文件先存本机**（音频大、省配额），是否上云待定；不做语音转文字（暂缓） |
| 复习入口 | 首页**独立入口** |
| 复习范围 | 用户页面上自选：刚背完的一轮 / 整个题库 |
| 登录 | **单一账号**、**服务端校验**、**不开放注册**；账号创建方式待定（手机号验证码 / 邮箱密码） |
| 明确不做 | 按章节分组选范围、错题清单、开放注册 / 多账号管理、语音转文字（暂缓） |

## 已查清但本期暂缓：语音转文字
路线：**iPhone 可用 iOS Safari 自带的 `webkitSpeechRecognition`**（Safari 14.1 / iOS 14.5+），免费。
硬条件：必须用 **Safari 打开**（微信等 App 内置浏览器报 `service-not-allowed`）、必须 **HTTPS**、必须**联网**（音频会上传 Apple）、需授权麦克风与语音识别。
限制：**只能实时听麦克风，不能转写已有录音文件**。
结论全文见 `project-scope.md`「五、暂缓 / 后续版本」。

## 已知风险
- **风险一：PDF 解析准确率。** 产品能不能用的前提。若是扫描件（无文本层）需额外做 OCR。
- **风险二：后端依赖与配额。** 登录 / 题库 / 进度都依赖网络与服务端；云服务有配额，超出需升级；失败必须给出明确提示，不能静默失败。
- 题答同屏缺少主动回忆环节，但**复习模式正好弥补**（隐藏答案 + 开口复述）。

## 技术栈（2026-10-10 最终版 v2，详见 `tech-stack.md`）
**用户后端是 Express。** 架构：iPhone Safari → **Express（单端口，同时托管 Vite dist 与 `/api`）** → SQLite 文件。
> v1（浏览器内 SQLite WASM + 云服务 Auth）已废弃。该项目**不再依赖 WorkBuddy 云服务**（已开通，留着即可）。

| 层 | 选型 |
|---|---|
| 服务端 / 数据库 | Express 5 + **`node:sqlite`（Node 内置，零依赖）** |
| 登录 | `express-session` + **自写 SqliteStore（40 行）** + `crypto.scrypt` |
| 前端 | Vite + TS + React 19 + **BrowserRouter**（有 Express 兜底路由，不必用 hash） |
| PDF | 前端 `pdfjs-dist` 解析，结果 POST 入库 |
| 录音 | MediaRecorder → Blob，默认存本机 IndexedDB，上传开关待定 |

**头号选型原则：依赖必须零原生编译。** 沙箱无 C/C++ 工具链 → 淘汰 better-sqlite3 / sqlite3 / **connect-sqlite3（源码 require 原生 sqlite3 却未在 package.json 声明，已拆包确认）** / bcrypt / argon2。
`node:sqlite` 在 Node **22.22.2 实测可用且无需 flag**。

**部署硬性要求**：`app.listen(process.env.PORT, '0.0.0.0')`；**必须 `app.set('trust proxy', 1)`**（否则 HTTPS 下 secure Cookie 不下发，症状是"登录成功但刷新就掉线"）；路由顺序 `/api` → `static(dist)` → `app.get('*')` 兜底，不可颠倒。

**两个 v1 的坑自动消失**：iOS 7 天清存储、换设备丢进度 —— 数据在服务端。决策 5「跨设备接着背」重新成立。

**唯一未验证风险**：重新发布后 SQLite 文件是否持久（发布环境明确支持 SQLite、明确不支持 MySQL/PG/Redis，但没保证磁盘）。兜底加「导出/导入题库 JSON」。验证：上线导入题库 → 再发布一次 → 看数据是否还在。

## 测试策略（2026-10-10 定，详见 `tech-stack.md` 第十一节，已实测跑通）
**用户定：RTL 做 component test，Playwright 做 e2e。** 三层验证：
- **L1 组件** Vitest 5 + RTL 16 + jsdom 30（React 19）→ 实测 **4/4 通过**
- **L2 e2e** Playwright 1.64（Chromium + `--use-fake-device-for-media-stream` 假麦克风）→ 实测 **2/2 通过**，含 iPhone 13 视口 390×844
- **L3 真机** iPhone Safari 手动清单 5 项 —— **不可省**，macOS WebKit ≠ iOS Safari

**实测硬结论（别再重查）**：
1. **jsdom 里没有 `MediaRecorder`、没有 `navigator.mediaDevices`**（实测 undefined）→ 录音必须抽成 `src/lib/recorder.ts` 接口，组件测试 `vi.mock` 换桩，真录音只在 e2e 跑
2. **Chromium 的 MediaRecorder 出 `audio/mp4;codecs=opus`，不是 webm** → **录音文件扩展名绝不能写死 `.webm`**，必须按 `recorder.mimeType` 推导（iPhone 出 audio/mp4）
3. 组件测试最该锁的是 ued.md 的硬约束：**对照答案前，整个 `document.body.textContent` 都不得出现答案文本**

**Playwright 四个真坑**：① `devices['iPhone 13']` 默认切 WebKit（报 webkit 未安装），须在 `...devices` 前显式写 `browserName:'chromium'` ② 项目 `"type":"module"` 下服务端 `.js` 用 `require` 会报错，用 `.cjs` ③ `webServer.url` 探测根路径且 **404 算未就绪** ④ 浏览器 build 版本要与 Playwright 版本匹配（缓存 1243 vs 1.64 要 1248）。

**本机环境问题**：`npx playwright install` 报 `EEXIST: __dirlock` 是因为 `~/Library/Caches/ms-playwright/__dirlock` 有旧空锁目录，**用 `rmdir` 清掉即可**（已处理过一次）。

## 文件约定
- `tech-stack.md`：技术栈方案 **v2**（Express + node:sqlite + 自建登录 + 测试策略）。含选型表、零原生编译原则、登录方案、部署约束、测试三层策略、目录结构与安装命令。
- `project-scope.md`：需求定义文档。原始需求在上，确认后的结论在下（「需求细化」章节）。
- `design/ued.md`：**UED 设计规范 v1**（设计令牌、组件清单、页面流程、逐屏说明含 Figma Frame/Auto Layout 建议、给开发的标注要点）。
- `design/prototype.html`：**可交互高保真原型**，含 11 个界面（登录 / 首页含未导入态 / 导入 / 解析结果 / 背诵 / 复习选范围 / 复习待录 / 录音中 / 对照答案 / 我的），顶部标签切换，手机浏览器可直接打开。
- `design/svg/`：**11 个界面 SVG**（390×844），可直接拖进 Figma 变可编辑矢量图层（零安装路径）。
- `design/preview/`：**11 张 PNG 预览图**，仅用于看，不可编辑。
- `design/build-svg.js`：**SVG 生成脚本**（纯 Node，无第三方依赖）。改设计只改这一个文件，运行 `node design/build-svg.js` 重新输出。
- `figma-plugin/`：**Figma 设计稿生成插件**（`manifest.json` + `code.js`，约 1110 行）。在 Figma 桌面端「导入 manifest」后运行，会原生生成 4 个页面：Design Tokens（13 个 Paint Style + 7 个 Text Style）、Components（9 组组件含变体）、Screens（11 个 390×844 界面 + 原型跳转连线）、Prototype（流程说明）。**环境里没有 Figma 写入接口，这是产出真 Figma 设计稿的唯一可行路径。** 安装说明在 `design/ued.md` 第八节。
- **Figma 交付共三条路**（内容一致）：① 插件（可编辑+组件+Auto Layout，需 Figma 桌面端）② SVG 拖入（可编辑但扁平，零安装）③ PNG（只看）。对照表在 `design/ued.md` 第八节。
- **重要认知：`Figma Framelink MCP` 是只读的**（`get_figma_data` 读文件、`download_figma_images` 下图），**不能建稿**，只适合「已有 Figma 稿 → 生成代码」的方向。Figma 官方也只通过 Plugin API 开放写能力。
- **版本控制**：git 仓库，主分支 `main`。`.gitignore` 忽略 `node_modules/`、`dist/`、`build/`、`.DS_Store`、`*.log`、`.env*`。`.workbuddy/`（项目记忆）已纳入版本控制。

## 当前卡点
题库 PDF 尚未放进项目目录。**下一步第一件事就是拿到真实 PDF 并跑一次解析验证。**
