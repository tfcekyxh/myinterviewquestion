# 项目长期记忆：myInterviewQuestion

## 项目目标
把一份本地题库 PDF，转成可在手机上翻卡复习的题目卡片。用户是备考者本人，痛点是「PDF 里的题目没法一道一道地刷」。

**用户设备：只用 iPhone。** 所有兼容性决策以此为前提。

## P0–P5 已全部完成（2026-10-13）
- **P4 真机 5 项清单已验完**：iPhone Safari 上授权弹窗正常、能录、能回放、底部按钮不被 Home 条遮挡、加到主屏幕正常。
  → **录音路线（MediaRecorder + 自签 HTTPS 本地调试）在真机上成立**，不用再怀疑。
- **P5 上线收尾已完成**：网络失败提示、401 处理、manifest + 图标。
- 唯一仍未知的是「重新发布后 SQLite 文件是否持久」—— 只能上线验证，兜底（导出/导入 JSON）已在 P2.5 做完。

## P0–P4 已落地（2026-10-11，代码在仓库里）

- **P0 PDF 解析：准确率 100%**（200/200，无需 OCR）。规则：**题干行字号 9.65 vs 正文 8.25**，靠字号台阶切题——不能按编号/按页/按空行切。详见 `pdf-parse-report.md` 与 `web/src/lib/pdf/parse.ts`。
- **P1 骨架+登录**：Express 5 + `node:sqlite` + `scrypt` + 自写 SqliteStore；单账号 `admin`，密码在 `.env`（不进 git）。
  ⚠️ **改密码不能只改 `.env`**：`ensureUser()` 只在用户不存在时写库，用户已存在就直接 return，改 `.env` 不生效。
  而**删 `data/app.db` 会连题库和进度一起丢掉**（P1 时给的那条建议是错的）。正确做法是直接改 `users` 表的 `pwd_hash`/`pwd_salt`（用 `hashPassword()` 生成）。
- **P2 导入闭环**：浏览器端 pdfjs → `parse.ts` 切题 → 预览 → 整批入库（事务）。
- **P2.5 导出/导入题库 JSON**：`/bank`，`data/app.db` 丢失时的兜底。
- **P3 背诵模式**：`/recite`（题答同屏 + 顺序/随机 + 进度存服务端）；首页进度卡；`/bank` 可重置进度。
- **P4 复习模式**：`/review`（选范围）+ `/review/run`（待录 → 录音中 → 对照答案）；录音只存本机。
- 代码结构：根目录 npm workspaces，`server/`（Express ESM）+ `web/`（Vite/React/TS）+ `e2e/` + `scripts/`。
- 命令：`npm run dev:server`（:3000）、`npm -w web run dev`、`npm test`、`npm run typecheck`、`npm run test:e2e`、`npm run pdf:extract`、`npm run smoke:auth` / `smoke:progress`。
- **Node 22 可直接运行 `.ts`**（类型擦除），所以 Node 脚本与浏览器共用同一份解析源码。

## 录音与复习（P4 定，改动前先看）
- **答案只在 `stage === 'compare'` 的条件里渲染**，不是用样式藏起来 —— 这是产品核心约束，有专门的组件测试。
- **音频只存本机 IndexedDB**（`lib/audioStore.ts`，fail-soft），**不上云**；`reviews.audio_path` 存的是本机录音的键。
- **录音逻辑全在 `lib/recorder.ts` 接口后**（jsdom 里没有 MediaRecorder）。扩展名一律 `extForMime(mimeType)` 推导，**绝不写死 `.webm`**。
- ⚠️ **`pointerdown` 上不能 `preventDefault()`** —— 会吃掉后续 pointerup，症状是「按住录音松手不结束」。防长按选中用 CSS。
- **objectURL（回放）必须在事件处理里一次算好**，放 `useEffect` 里会让 UI 先以禁用态出现一帧。
- **一轮 = 从这一轮起点背到最后一题**；起点由客户端进背诵页时写，服务端写进度时结算成 `lastRound`。

## 进度模型（P3 定，改动前先看）
- `progress` 表是**单行 JSON**（`id=1` 恒成立），字段 `mode / posOrder / posRandom / randOrder / total`。
- **位置语义是「已背题数」，取值 0..N，不是数组下标**；取到 N = 这一轮背完了（否则「已背 240/240」无法表达）。
- **顺序与随机各存一个位置**，这是「切模式不丢进度」的前提。
- **随机序列 `randOrder` 也存服务端**，否则刷新会重洗，做不到「刷新停在同一题」。
- **题库规模一变，位置一律归零**（旧位置指向别的题，比丢掉更糟）。
- 客户端写进度**必须串行化**（Promise 链），并发 PUT 网络乱序会让位置回退。

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
- ~~**风险一：PDF 解析准确率。**~~ **已消除**：2026-10-11 实测准确率 100%，见 `pdf-parse-report.md`。
- **风险二：后端依赖与配额 / SQLite 磁盘持久性。** 登录、题库、进度都依赖网络与服务端；**「重新发布后 SQLite 文件是否还在」仍未验证**（P1 唯一的遗留 DoD）。缓解：导出/导入题库 JSON。
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
- **L1 组件** Vitest + RTL + jsdom（React 19）→ 当前 **96 条全绿**
- **L2 e2e** Playwright（Chromium + `--use-fake-device-for-media-stream` 假麦克风）→ 当前 **20 条全绿**，含 iPhone 13 视口 390×844
- **L3 真机** iPhone Safari 手动清单 5 项 —— **2026-10-13 已验完，全过**（模拟器不算，但真机这次真跑了）
- 另有接口级冒烟：`scripts/smoke-auth.mjs`（11 项）、`scripts/smoke-progress.mjs`（39 项，含复习记录与轮次结算）

**`vite build` 不做类型检查（esbuild 只剥类型）。`npm run build` 已改成先跑 `tsc --noEmit`** —— 补上后立刻暴露了 4 处真 bug，其中 `Import.tsx` 的 `stage` 判断漏 `'saving'` 会导致「入库中…」永远看不到。

**e2e 顺序与共享状态**：各 spec 顺序执行、共用同一个服务与 `data/test.db` → 每个 spec 要么自播种数据，要么把依赖初始状态的用例放进 `00-empty.spec.ts`。`recite.spec.ts` 会把题库换成 12 道 fixture，必须排在 `import.spec.ts` 之后。**改首页文案要同步 e2e 里的可见文本断言**（已踩：`共 200 题` → `已背 0 / 200`）。

**实测硬结论（别再重查）**：
1. **jsdom 里没有 `MediaRecorder`、没有 `navigator.mediaDevices`**（实测 undefined）→ 录音必须抽成 `src/lib/recorder.ts` 接口，组件测试 `vi.mock` 换桩，真录音只在 e2e 跑
2. **Chromium 的 MediaRecorder 出 `audio/mp4;codecs=opus`，不是 webm** → **录音文件扩展名绝不能写死 `.webm`**，必须按 `recorder.mimeType` 推导（iPhone 出 audio/mp4）
3. 组件测试最该锁的是 ued.md 的硬约束：**对照答案前，整个 DOM 都不得出现答案文本**
   ⚠️ 但**不能直接用 `document.body.textContent`** —— 内联 `<script>` 源码会被算进去导致永远失败。
   须先 `clone.querySelectorAll('script,style,template').forEach(n=>n.remove())` 再取 textContent（实测踩到）

**Playwright 五个真坑**：① `devices['iPhone 13']` 默认切 WebKit（报 webkit 未安装），须在 `...devices` 前显式写 `browserName:'chromium'` ② 项目 `"type":"module"` 下服务端 `.js` 用 `require` 会报错，用 `.cjs` ③ `webServer.url` 探测根路径且 **404 算未就绪** ④ 浏览器 build 版本要与 Playwright 版本匹配（缓存 1243 vs 1.64 要 1248）⑤ **`chromium_headless_shell` 是独立组件**，`install chromium` 未必装上 → 配置加 `channel:'chromium'` 绕开（本机即此情况，已实测通过）。

**本机 Playwright 环境现状（2026-10-10）**：chromium-1248 已完整安装；缺 headless shell（ffmpeg 下载失败导致后续组件没走到，ffmpeg 只用于录视频不需要）；WebKit 未下载；陈旧 `__dirlock` 已 `rmdir` 清掉（再遇 `EEXIST: __dirlock` 就是同样原因）。

## 文件约定
- `impl-plan.md`：**分阶段实施方案 P0–P5**（2026-10-10 定）。排期按风险倒序：P0 验证 PDF 解析（最高风险，含决策门）→ P1 骨架+登录（**可与 P0 并行**，顺手验证磁盘持久性）→ P2 导入闭环 → P3 背诵 → P4 复习录音 → P5 兜底收尾。每阶段有 DoD 验收清单。功能开发用 fixture 假题库驱动，不等真实 PDF。
- `CLAUDE.md`：**给 AI 编码助手的项目约定**（2026-10-10 新建）。含文档索引、8 条硬约束红线、测试约定、git 约定、明确不做清单。
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

## 真机调试（录音必须这么测，2026-10-11 定）
**Safari 只在安全上下文（HTTPS 或 localhost）下给麦克风权限**，手机上的 localhost 是手机自己，
所以手机开发必须 HTTPS。本机方案已就绪：
- `npm run cert:gen` → `certs/dev.{crt,key,cer}`（SAN 自动带本机所有局域网 IP，CA:TRUE，1 年）
- `npm run dev:https` → HTTP(:3000) + HTTPS(:3443)；**HTTPS 只在 `HTTPS=1` 时启动**（否则 e2e 会抢 3443 端口）
- 手机：先装 `http://<本机IP>:3000/__dev/cert.cer` → 设置里安装 → **证书信任设置里开启完全信任** → 开 `https://<本机IP>:3443`
- `certs/` 已 gitignore；**换 Wi-Fi 后 IP 变了要重新生成证书**（旧 IP 在 SAN 里写死了）
- 另一条路是发布到公网 HTTPS（`workbuddy_sites_deploy`），用户倾向数据不出本机，所以选的自签证书

## P5 的三条硬结论（2026-10-13，改这块前先看）
1. **网络失败必须在 `fetch` 那一层兜住。** fetch 只在「请求根本没发出去」时 reject，抛英文 `TypeError`；
   反向代理挂了还会回**一页 HTML**，`JSON.parse` 炸成 `Unexpected token '<'`。统一换成 `NET_ERROR_MESSAGE`。
2. **401 有两种语义，混了会死循环**：`/api/me` 的 401 = 未登录（探活，返回 null）；
   `/api/login` 的 401 = 密码不对（正常业务结果）；**只有其他接口的 401 才是登录态过期**
   → 走 `setUnauthorizedHandler` 踢回登录页。不区分的话，登录页收到 401 → 触发 handler → 再探活 → 又 401。
3. **图标只能自己写 PNG 编码器**（`scripts/gen-icons.mjs`，zlib + CRC32，零依赖，4 倍超采样降噪）。
   环境没有图像库（sharp/canvas 都要原生编译），而 **iOS 的 `apple-touch-icon` 只认 PNG，SVG 不生效**。
   `npm run icon:gen` 重新生成 → `web/public/icon-{180,192,512}.png`。
4. **冒烟脚本必须打在全新库上**：`server/db.js` 支持 `DB_PATH`，`smoke-*.mjs` 用它开一次性库。
   直接打 `data/app.db` 时「复习记录初始为 0」这类断言跑第二遍必然失败（第一次明明是过的）。

## 关键源码地图
| 位置 | 职责 |
|---|---|
| `server/db.js` | `node:sqlite` 建表 + `progress` 单行 JSON 读写 + 老结构迁移；支持 `DB_PATH` 指定库文件 |
| `server/routes/auth.js` / `questions.js` / `progress.js` / `reviews.js` | 登录、题库（整批替换）、进度、复习记录 |
| `web/src/lib/pdf/parse.ts` | **切题纯函数**（Node 与浏览器共用），13 条单测 |
| `web/src/lib/pdf/extract.ts` | 浏览器端 pdfjs 抽文本项（动态 import，只有导入页加载） |
| `web/src/lib/recite.ts` | 洗牌与进度换算纯逻辑 |
| `web/src/lib/recorder.ts` | **录音抽象层**（jsdom 没 MediaRecorder，组件测试必须换桩）+ 扩展名推导 |
| `web/src/lib/audioStore.ts` | 录音存本机 IndexedDB（fail-soft，音频不上云） |
| `web/src/lib/api.ts` | 前端访问后端的唯一入口（含 `ProgressState` / `ReviewRound`）；网络失败与 401 都在这里兜 |
| `web/src/components/ErrorScreen.tsx` | **整页失败态**：任何接口失败都用它（role=alert + 一个退路按钮），不允许白屏 |
| `web/src/pages/` | `Login` / `Home` / `Import` / `Bank` / `Recite` / `ReviewScope` / `Review` |
| `web/src/styles.css` | 原生 CSS Variables 映射 `ued.md` 设计令牌 |
| `web/src/test-setup.ts` | 给 jsdom 补 `createObjectURL` 与音频 `play/pause` |

## 当前状态
**P0–P5 全部完成，真机已验。** 没有卡点了。

如果要继续，可选的下一步（都没被要求）：
① 上线（发布到公网 HTTPS）—— 顺带验证「重新发布后 SQLite 是否还在」这个最后的风险点
② 语音转文字（`webkitSpeechRecognition`，方案已查清，见下）
③ 错题清单 / 按章节选范围（需求里明确不做的两项，要做得先改 `project-scope.md`）
