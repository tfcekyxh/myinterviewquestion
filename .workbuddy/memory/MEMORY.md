# 项目长期记忆：myInterviewQuestion

## 项目目标
把一份本地题库 PDF，转成可在手机上翻卡复习的题目卡片。痛点是「PDF 里的题目没法一道一道地刷」。

**用户设备：只用 iPhone。** 所有兼容性决策以此为前提。

## 架构（以此为准，凡见「无后端/存本地」旧描述一律作废）
iPhone Safari → **Express（单端口，托管 Vite dist + `/api`）** → SQLite 文件。**不依赖 WorkBuddy 云服务**（虽已开通 `wbapp_o7AapivIxLQCXzwxNNvNVa`，留着不用）。

| 层 | 选型 |
|---|---|
| 服务端 / 数据库 | Express 5 + **`node:sqlite`（Node 内置，零依赖）** |
| 登录 | `express-session` + **自写 SqliteStore（40 行）** + `crypto.scrypt`，单账号 `admin` |
| 前端 | Vite + TS + React 19 + **BrowserRouter**（有 Express 兜底路由） |
| PDF | 前端 `pdfjs-dist` 解析，结果 POST 入库 |
| 录音 | MediaRecorder → Blob，存本机 IndexedDB |

**头号选型原则：依赖必须零原生编译**（沙箱无 C/C++ 工具链）→ 淘汰 better-sqlite3 / sqlite3 / connect-sqlite3 / bcrypt / argon2。`node:sqlite` 在 Node 22.22.2 实测可用无需 flag。

**部署硬性要求**：`app.listen(PORT, '0.0.0.0')`；**必须 `app.set('trust proxy', 1)`**（否则 HTTPS 下 secure Cookie 不下发，症状「登录成功但刷新掉线」）；路由顺序 `/api` → `static(dist)` → `app.get('*')` 兜底，不可颠倒。

代码结构：根目录 npm workspaces，`server/`（Express ESM）+ `web/`（Vite/React/TS）+ `e2e/` + `scripts/`。
命令：`npm run dev:server`(:3000)、`npm -w web run dev`、`npm test`、`npm run typecheck`、`npm run test:e2e`、`npm run pdf:extract`、`npm run smoke:auth|progress|backup`。
**Node 22 可直接跑 `.ts`**（类型擦除）→ Node 脚本与浏览器共用同一份解析源码。

## 已上线（2026-10-14）
- **链接**：https://interview-flashcards-29811.app.workbuddy.host/
- 部署参数：`language: node`、`port: 3000`、`startCmd: "npm run build && APP_ACCOUNT=... APP_PASSWORD=... SESSION_SECRET=... node server/index.js"`
  - `dist/` 在 .gitignore 不上传 → **build 必须写进 startCmd**
  - `.env` 不进 git → **环境变量必须靠 startCmd 注入**，否则 `ensureUser()` 报错 exit 1
- 管理入口：设置 → 数据管理 → 应用（可重新发布 / 取消发布）
- ⚠️ **`data/` 会被一起上传**（工具只排除 node_modules/.git/构建产物）→ **每次重新发布会用本地 `data/app.db` 覆盖线上数据**。副作用：注入的新密码不生效（users 表已有 admin，`ensureUser` 直接 return）→ 新密码登录 401。
- 线上与本地密码目前统一为 `liujiantao`（偏弱，建议换）。
- ⚠️ **改密码不能只改 `.env`**，也不能删 `data/app.db`（会连题库和进度一起丢）。正确做法：`scripts/set-password.mjs <db文件> <账号> <新密码>` 直接改 `users` 表的 `pwd_hash`/`pwd_salt`（scrypt，salt 16B、密钥 64B，与 `server/auth.js` 一致）。线上改法：GET `/api/backup` 下载 → 本地改 → POST `/api/restore` 传回。**本地库也要一起改**，否则下次重发被覆盖回去。

## PDF 解析（P0，已消除风险）
**准确率 100%**（200/200，无需 OCR）。规则：**题干行字号 9.65 vs 正文 8.25**，靠字号台阶切题——不能按编号/按页/按空行切。详见 `pdf-parse-report.md` 与 `web/src/lib/pdf/parse.ts`（纯函数，13 条单测）。

## 进度模型（P3 定，改动前先看）
- `progress` 表是**单行 JSON**（`id=1` 恒成立），字段 `mode / posOrder / posRandom / randOrder / total`。
- **位置语义是「已背题数」，取值 0..N，不是数组下标**；取到 N = 这一轮背完了（否则「已背 240/240」无法表达）。
- **顺序与随机各存一个位置**；随机序列 `randOrder` 也存服务端（否则刷新重洗）。
- **题库规模一变，位置一律归零**（旧位置指向别的题，比丢掉更糟）。
- 客户端写进度**必须串行化**（Promise 链），并发 PUT 网络乱序会让位置回退。
- **一轮 = 从这一轮起点背到最后一题**；起点由客户端进背诵页时写，服务端结算成 `lastRound`。

## 录音与复习（P4 定，改动前先看）
- **答案只在 `stage === 'compare'` 的条件里渲染**，不是用样式藏起来 —— 产品核心约束，有专门组件测试。
- **音频只存本机 IndexedDB**（`lib/audioStore.ts`，fail-soft，Safari 无痕模式会抛）；`reviews.audio_path` 存的是本机键。**服务端不收一个字节。**
- **「持久化」靠用户主动导出**（2026-10-14 定，用户选的是「单条保存 + 批量导出」）：`lib/clipExport.ts` + 页 `pages/Clips.tsx`「我的录音」。
  优先调 iPhone 原生分享面板（Web Share Level 2，iOS 15+），不支持才降级 `<a download>`。数据流是**用户自己的设备/iCloud**，不违背上面那条。
- ⚠️ **不能往 Express 自己的 `data/audio/` 存**：每次重新发布会用本地 `data/` 覆盖线上，SQLite 持久性都没验证。
- ⚠️ **立刻 `revokeObjectURL` 会掐断还没开始的下载**（iOS 表现「点了没反应」）→ 延后释放。有测试盯着。
- ⚠️ 录音 key 固定 `clip:${题号}:${时间戳}`，题号一律 `seqOfClip()` **从 key 反解**、不新加字段 —— 线上已有的一批数据没有 seq 字段。
- ⚠️ `<audio>` 换 src 后 **`autoPlay` 不会再次触发**，必须自己在 effect 里 `play()`。光靠属性只有第一段能响。
- **录音逻辑全在 `lib/recorder.ts` 接口后**（jsdom 没有 MediaRecorder）。扩展名一律 `extForMime(mimeType)` 推导，**绝不写死 `.webm`**（Chromium 出 `audio/mp4;codecs=opus`，iPhone 出 `audio/mp4`）。
- ⚠️ **`pointerdown` 上不能 `preventDefault()`** —— 吃掉后续 pointerup，症状「按住录音松手不结束」。防长按选中用 CSS。
- **objectURL 必须在事件处理里一次算好**，放 `useEffect` 会让 UI 先以禁用态出现一帧。
- ⚠️ iOS 上必须**在用户手势同一任务里**先 `new AudioContext`（`await getUserMedia` 之前），否则 Audiostream suspended、波形贴底。
- 必须是 Safari/HTTPS 才有麦克风权限（见「真机调试」）。

## 整库导出 / 还原（2026-10-13 新增，动这块前必看）
- **和「导出题库 JSON」是两回事**：JSON 只带题目，整库 `.db` 连**进度、复习记录、账号**一起带走。入口 `/bank` 下半部分「数据库备份」。
- `GET /api/backup` 用 **`VACUUM INTO` 一致性快照**，不直接 copy 正在写的 .db。
- `POST /api/restore` 收**原始字节** → 挂 `express.raw`，**不能走全局 `express.json`**。⚠️ 客户端带 `application/json` 头 POST 二进制会被拦成 **400**，到不了鉴权。
- **还原顺序不能乱**：验文件（文件头 → 缺表 → 真读一次）→ 关连接 → 旧库改名 `.bak` → 落新文件 → 清 `-journal/-wal/-shm` → 重开；**任一步失败把 `.bak` 换回去**。
- 还原后**把当前 session 写回新库**，否则用户被踢下线（看起来像「还原弄坏了」）。
- ⚠️ `server/db.js` 的 `db` 是 **`export let`**（ESM live binding），还原后重新赋值 → **各处 `db.prepare()` 必须写在处理函数里**，不能在模块顶层存成局部常量。

## P5 三条硬结论（2026-10-13，改这块前先看）
1. **网络失败必须在 `fetch` 那层兜住**：fetch 只在请求没发出去时 reject（英文 TypeError）；反代挂了还回**一页 HTML**，`JSON.parse` 炸成 `Unexpected token '<'`。统一换 `NET_ERROR_MESSAGE`。
2. **401 有两种语义，混了会死循环**：`/api/me` 的 401 = 未登录（探活→null）；`/api/login` 的 401 = 密码错（正常业务）；**只有其他接口的 401 才是登录态过期** → `setUnauthorizedHandler` 踢回登录页。
3. **图标只能自己写 PNG 编码器**（`scripts/gen-icons.mjs`，zlib+CRC32 零依赖，4 倍超采样）。环境无图像库（sharp/canvas 需原生编译），而 **iOS `apple-touch-icon` 只认 PNG，SVG 不生效**。`npm run icon:gen` → `web/public/icon-{180,192,512}.png`。

## 测试策略（三层，用户定：RTL 做组件测试、Playwright 做 e2e）
- **L1 组件** Vitest + RTL + jsdom（React 19）→ **96 条全绿**
- **L2 e2e** Playwright（Chromium + `--use-fake-device-for-media-stream` 假麦）→ **20 条全绿**，含 iPhone 13 视口 390×844
- **L3 真机** iPhone Safari 手动清单 5 项 —— **已验完全过**（授权弹窗/能录/能回放/底部按钮不被 Home 条遮挡/加到主屏幕）
- 接口冒烟：`smoke-auth.mjs`(11)、`smoke-progress.mjs`(39)、`smoke-backup.mjs`(22，自带一次性服务与临时库)
- ⚠️ **冒烟脚本必须打全新库**：`server/db.js` 支持 `DB_PATH`。打 `data/app.db` 时「初始为 0」类断言第二遍必失败。
- **`vite build` 不做类型检查**，`npm run build` 已改成先跑 `tsc --noEmit`（补上后立刻暴露 4 处真 bug）
- **e2e 顺序与共享状态**：各 spec 顺序执行、共用同一服务与 `data/test.db` → 每 spec 要么自播种，要么把依赖初始态的用例放 `00-empty.spec.ts`。`recite.spec.ts` 会把题库换成 12 道 fixture，必须排在 `import.spec.ts` 之后。**改首页文案要同步 e2e 可见文本断言**（已踩：`共 200 题` → `已背 0 / 200`）。
- **组件测试锁答案约束时，不能直接用 `document.body.textContent`** —— 内联 `<script>` 源码会被算进去导致永远失败。须先 `clone.querySelectorAll('script,style,template').forEach(n=>n.remove())` 再取 textContent。
- **Playwright 五个坑**：① `devices['iPhone 13']` 默认切 WebKit（未安装），须在 `...devices` **前**写 `browserName:'chromium'` ② `"type":"module"` 下服务端 `.js` 用 `require` 报错，用 `.cjs` ③ `webServer.url` 探测根路径且 **404 算未就绪** ④ 浏览器 build 版本要匹配（1243 vs 1.64 要 1248）⑤ **`chromium_headless_shell` 是独立组件**，`install chromium` 未必装上 → 配置加 `channel:'chromium'` 绕开。
- **本机环境（2026-10-10）**：chromium-1248 已装；缺 headless shell；WebKit 未下载；遇 `EEXIST: __dirlock` 就 `rmdir` 清掉。

## 真机调试（录音必须这么测）
**Safari 只在安全上下文（HTTPS 或 localhost）给麦克风权限**，手机上的 localhost 是手机自己 → 手机开发必须 HTTPS。本机方案：
- `npm run cert:gen` → `certs/dev.{crt,key,cer}`（SAN 自动带本机所有局域网 IP，CA:TRUE，1 年）
- `npm run dev:https` → HTTP(:3000) + HTTPS(:3443)；**HTTPS 只在 `HTTPS=1` 时启动**（否则 e2e 抢 3443）
- 手机：装 `http://<本机IP>:3000/__dev/cert.cer` → 设置里安装 → **证书信任设置里开启完全信任** → 开 `https://<本机IP>:3443`
- `certs/` 已 gitignore；**换 Wi-Fi 后 IP 变了要重生成证书**（旧 IP 写死在 SAN）

## 关键源码地图
| 位置 | 职责 |
|---|---|
| `server/db.js` | `node:sqlite` 建表 + `progress` 单行 JSON 读写 + 老结构迁移；支持 `DB_PATH` |
| `server/routes/auth.js` / `questions.js` / `progress.js` / `reviews.js` | 登录、题库（整批替换）、进度、复习记录 |
| `server/routes/backup.js` | **整库导出 / 还原** |
| `web/src/lib/pdf/parse.ts` | **切题纯函数**（Node 与浏览器共用），13 条单测 |
| `web/src/lib/pdf/extract.ts` | 浏览器端 pdfjs 抽文本项（动态 import，只有导入页加载） |
| `web/src/lib/recite.ts` | 洗牌与进度换算纯逻辑 |
| `web/src/lib/recorder.ts` | **录音抽象层**（jsdom 没 MediaRecorder，测试必须换桩）+ 扩展名推导 |
| `web/src/lib/audioStore.ts` | 录音存本机 IndexedDB（fail-soft）；`seqOfClip()` 从 key 反解题号、`listClips()` 倒序列全部 |
| `web/src/lib/clipExport.ts` | **录音导出**：系统分享面板优先 → 降级 `<a download>`；`formatBytes`/`formatClipTime` |
| `web/src/pages/Clips.tsx` | 「我的录音」页：列表 + 回听 + 单条导出/删除 + 全部导出（带进度与停止） |
| `web/src/lib/api.ts` | 前端访问后端唯一入口；网络失败与 401 都在这兜 |
| `web/src/components/ErrorScreen.tsx` | **整页失败态**：任何接口失败都用它（role=alert + 退路按钮），不允许白屏 |
| `web/src/pages/` | `Login` / `Home` / `Import` / `Bank` / `Recite` / `ReviewScope` / `Review` |
| `web/src/styles.css` | 原生 CSS Variables 映射 `ued.md` 设计令牌 |
| `web/src/test-setup.ts` | 给 jsdom 补 `createObjectURL` 与音频 `play/pause` |

## 文件约定
- `impl-plan.md`：分阶段方案 P0–P5 + 每阶段 DoD 验收清单。
- `CLAUDE.md`：给 AI 编码助手的项目约定（文档索引、8 条硬约束红线、测试/ git 约定、明确不做清单）。
- `tech-stack.md`：技术栈 v2 全量（选型表、零原生编译原则、登录方案、部署约束、测试策略、安装命令）。
- `project-scope.md`：需求定义（原始需求在上，「需求细化」结论在下）。**需求变更要先改这里。**
- `design/ued.md`：UED 设计规范 v1；`design/prototype.html`：可交互高保真原型（11 屏）；`design/svg/`、`design/preview/`、`design/build-svg.js`（改设计只改这一个文件）。
- `figma-plugin/`：**Figma 设计稿生成插件**（manifest.json + code.js，约 1110 行），在 Figma 桌面端导入 manifest 运行，原生生成 4 个页面（Tokens 13 Paint+7 Text / Components 9 组 / Screens 11 屏+跳转 / Prototype）。**环境无 Figma 写入接口，这是产出真 Figma 稿的唯一路径。**
- **Figma 交付三条路**：① 插件（可编辑+组件+Auto Layout，需桌面端）② SVG 拖入（可编辑但扁平，零安装）③ PNG（只看）。对照表见 `ued.md` 第八节。
- **`Figma Framelink MCP` 是只读的**（`get_figma_data` 读、`download_figma_images` 下图），**不能建稿**。
- git：主分支 `main`。`.gitignore` 忽略 `node_modules/`、`dist/`、`build/`、`.DS_Store`、`*.log`、`.env*`、`certs/`、`/pdf/`（根目录题库原件）。`.workbuddy/`（项目记忆）已纳入版本控制。
- ⚠️ **gitignore 目录规则必须带前导斜杠**（2026-10-14 血的教训）：旧版写的是 `pdf/` 而不是 `/pdf/`，
  而不带斜杠、以 `/` 结尾的模式会匹配**任意层级**同名目录 → `web/src/lib/pdf/`（切题算法 + 13 条单测）
  被一并吞掉，**从未进过版本库**。后果：换机器/新 worktree 时 PDF 导入直接消失，`typecheck`/`build` 全红
  （`vite build` 自己不查类型，但 `npm run build` 先跑 `tsc`，所以照样崩）。
  部署当时没炸只是因为发布工具上传本地文件、不走 git。**加 ignore 目录规则一律写 `/xxx/`**。

## 已完成的功能阶段
- P1 骨架+登录 → P2 导入闭环 → P2.5 导出/导入题库 JSON → P3 背诵（题答同屏，顺序/随机，进度存服务端）→ P4 复习（答案隐藏→开口讲录音→对照答案）→ P5 收尾（网络失败提示、401 处理、manifest+图标）。**P0–P5 全部完成，真机已验，已上线。**

## 已知风险与待办
- **后端磁盘持久性**：登录/题库/进度都依赖服务端；**「重新发布后 SQLite 是否还在」仍未验证**（唯一遗留 DoD）。线上现有真实数据（200 题 + 进度 + 7 条复习记录），下次重发可顺手验。兜底：整库导出/导入 + 题库 JSON。
- 题答同屏缺主动回忆环节，**复习模式正好弥补**（隐藏答案+开口复述）。
- **语音转文字（暂缓，方案已查清）**：iPhone 可用 iOS Safari 自带 `webkitSpeechRecognition`（Safari 14.1/iOS 14.5+，免费）。硬条件：**必须 Safari 打开**（微信内置浏览器报 `service-not-allowed`）+ HTTPS + 联网（音频上传 Apple）+ 授权。**只能实时听麦克风，不能转写已有录音文件。** 详见 `project-scope.md`「五、暂缓」。
- 其他可选项：错题清单 / 按章节选范围（需求里**明确不做**，要做先改 `project-scope.md`）。

## 当前状态（2026-10-14）
上线运行。用户正在考虑**录音的持久化方案**（现仅存本机 IndexedDB，换设备/清缓存会丢）。
