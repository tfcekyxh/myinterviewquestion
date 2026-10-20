# 项目长期记忆：myInterviewQuestion

## 目标与设备
本地题库 PDF → 手机上翻卡刷题。**用户只用 iPhone**，所有兼容性决策以此为前提。

## 架构
iPhone Safari → **Express 单端口（托管 Vite dist + `/api`）** → SQLite 文件。不用 WorkBuddy 云服务。

| 层 | 选型 |
|---|---|
| 服务端/DB | Express 5 + **`node:sqlite`**（内置，零依赖） |
| 登录 | `express-session` + 自写 SqliteStore + `crypto.scrypt`，单账号 admin |
| 前端 | Vite + TS + React 19 + BrowserRouter |
| PDF | 前端 `pdfjs-dist` 解析后 POST 入库 |
| 录音 | MediaRecorder → 存本机 IndexedDB |

**头号原则：依赖零原生编译**（沙箱无 C/C++ 工具链）→ 淘汰 better-sqlite3/sqlite3/bcrypt/argon2。
**部署要求**：`listen(PORT,'0.0.0.0')` + **`app.set('trust proxy',1)`**（否则 HTTPS 下 secure Cookie 不下发，症状「登录成功刷新掉线」）；路由顺序 `/api` → static → `app.get('*')`。
结构：npm workspaces，`server/` + `web/` + `e2e/` + `scripts/`。命令：`dev:server`(:3000)、`npm -w web run dev`、`npm test`、`typecheck`、`test:e2e`、`pdf:extract`、`smoke:auth|progress|backup`。Node 22 可直接跑 `.ts`。

## 已上线（2026-10-14）
https://interview-flashcards-29811.app.workbuddy.host/ ；`startCmd` 必须含 `npm run build`（dist 不进 git）和环境变量注入（`.env` 不进 git）。
**固定 startCmd（2026-10-19 起，改了 server 入口后缀 + SESSION_SECRET 换新）**：
`npm run build && APP_ACCOUNT=admin APP_PASSWORD=liujiantao SESSION_SECRET=bR310wuEpfz_s4nBijOR0ZnJPgsjfB-h38y-pwsroU4FBIS-zpv87k1Q-vw29iOw LLM_API_KEY=ec2fa4db76a04f749522bbf8645b0aea.CT13fQ6WemsA3kZJ node server/index.ts`
⚠️ server 已全量迁 TS（2026-10-19，Node 22.22 原生 strip-types 直跑 .ts，零构建步骤）。**线上重发必须用这条 startCmd**；发布平台的 Node 必须 ≥22.18（否则去掉实验标记跑不了 .ts；本机 22.22.2 验证过直跑）。换 SESSION_SECRET 会让已登录的人掉线一次（pass 已改成强随机，旧值 `interview-flashcards-2026-secret` 作废）。
**发布前三步**：登录线上 → `GET /api/backup` 拉库 → 存成 `data/app.db`（让本地等于线上，覆盖无害）→ 删 `data/test.db`。
**发布后验证**：登录 200、`/api/questions` 题数不变、线上 bundle hash 与本地 `web/dist` 一致。
⚠️ **`data/` 会被一起上传** → 每次重发用本地 `data/app.db` 覆盖线上；因此**改密码不能只改 `.env`**，要用 `scripts/set-password.mjs <db> <账号> <新密码>` 改 `users` 表（本地库也要同步改）。线上改法：GET `/api/backup` → 本地改 → POST `/api/restore`。

## PDF 解析
准确率 100%（200/200）。**靠字号台阶切题：题干 9.65 vs 正文 8.25**，不能按编号/页/空行切。见 `pdf-parse-report.md`、`web/src/lib/pdf/parse.ts`（纯函数，13 单测）。

## 进度模型（改前必看）
- `progress` 是**单行 JSON**，字段 `mode/posOrder/posRandom/randOrder/total/roundStart`。
- **位置 = 已背题数，0..N**（N = 背完），不是数组下标。顺序/随机各存一个位置。
- 题库规模一变 → 位置归零。客户端写进度**必须串行化**（Promise 链），并发会让位置回退。
- 一轮 = 从 `roundStart` 背到最后一题。

## 录音与复习（改前必看）
- **答案只在 `stage==='compare'` 的条件里渲染**，不是样式隐藏 —— 核心约束，有专门测试。
- **音频只存本机 IndexedDB**（fail-soft），服务端不收字节；持久化靠用户主动导出（`lib/clipExport.ts` + 页 `pages/Clips.tsx`，Web Share 优先、降级 `<a download>`）。**不能存到 `data/audio/`**（会被重发覆盖）。
- 录音 key = `clip:${题号}:${时间戳}`，题号一律 `seqOfClip()` 从 key 反解，不加字段。
- 逻辑全在 `lib/recorder.ts` 接口后（jsdom 无 MediaRecorder）；扩展名用 `extForMime()` 推导，绝不写死 `.webm`。
- 坑：立刻 `revokeObjectURL` 会掐断下载（延后释放）；`<audio>` 换 src 后 `autoPlay` 不再触发（effect 里手动 `play()`）；`pointerdown` 不能 `preventDefault()`（吃掉 pointerup）；iOS 要在手势同一任务里先 `new AudioContext` 再 `getUserMedia`。

## 整库导出/还原
- 与「题库 JSON」两回事，`.db` 带进度/复习/账号。入口 `/bank` 底部。
- `GET /api/backup` 用 `VACUUM INTO`；`POST /api/restore` 收**原始字节 → `express.raw`**（客户端带 `application/json` 发二进制会被拦 400）。
- 顺序：验文件 → 关连接 → 旧库改名 `.bak` → 落新文件 → 清 `-journal/-wal/-shm` → 重开；失败换回 `.bak`。**还原后要把 session 写回新库**，否则被踢下线。
- ⚠️ `server/db.ts` 的 `db` 是 `export let`（还原后重赋值）→ **`db.prepare()` 必须写在处理函数内**，不能在模块顶层存常量。

## P5 三条硬结论
1. 网络失败在 `fetch` 层兜住：反代挂了回一页 HTML，`JSON.parse` 炸 → 统一 `NET_ERROR_MESSAGE`。
2. **401 两种语义**：`/api/me` = 未登录、`/api/login` = 密码错、其他接口 401 才踢回登录页。
3. 图标自写 PNG 编码器（`scripts/gen-icons.mjs`，iOS `apple-touch-icon` 只认 PNG）。

## 测试策略（三层）
L1 Vitest+RTL（**159 绿**）／L2 Playwright（20 条，含 iPhone 13 视口）／L3 真机清单（已全过）。
- ⚠️ 组件测试里推进朗读队列要**手动触发 `pendingUtterance.onend()`**（假 speak 不会自己结束）；
  `vi.useFakeTimers()` 必须在 `await findByText()` **之后**再切，否则 waitFor 卡死。
- 冒烟脚本**必须打全新库**（`DB_PATH`）。
- ⚠️ **`test:server` 必须显式列测试文件**（`node --test server/a.test.ts server/b.test.ts`）。这台机器的 Node 22.22 上 `node --test <目录>` 会把目录当主模块执行——`node --test server/` 实际跑了 `server/index.ts`，绑 3000 端口永久挂起。新增 server 测试要手动加进 `test:server`。
- server 全 TS 后根 `typecheck` = `tsc -p tsconfig.server.json` + web 的 `tsc --noEmit`；tsconfig.server.json 关键配置：NodeNext + `allowImportingTsExtensions`+`noEmit` + `allowSyntheticDefaultImports`（TS7 下 `export =` 的 express-session 默认导入要靠它才可调用）+ `verbatimModuleSyntax` + `erasableSyntaxOnly` + `strict` + `noUncheckedIndexedAccess`。
- `vite build` 不做类型检查 → `npm run build` 先跑 `tsc --noEmit`。
- e2e 各 spec 顺序执行、共用 `data/test.db`：`recite.spec.ts` 会换 12 道 fixture，必须排在 `import.spec.ts` 后；**改首页文案要同步 e2e 断言**。
- 组件测试断言文本前先 `querySelectorAll('script,style,template')` 移除再取 textContent。
- Playwright 坑：iPhone 13 device 要**在 `...devices` 前**写 `browserName:'chromium'`；模块下服务端用 `.cjs`；`webServer.url` 404 算未就绪；`channel:'chromium'` 绕开 headless shell 缺失。

## 真机调试
Safari 只在安全上下文给麦克风权限 → 手机开发必须 HTTPS：`npm run cert:gen` + `npm run dev:https`(:3443) + 手机装证书并开「完全信任」。换 Wi-Fi 要重生成（IP 写死在 SAN）。
⚠️ 3000/3443 常被**主仓残留服务**占着（本机两个仓库副本），curl 200 可能是旧代码 → 用 `lsof -p $(lsof -nP -iTCP:3000 -sTCP:LISTEN -t) | grep cwd` 确认。
⚠️ Chrome 会缓存 index.html 和 GET /api/* → 让用户 Cmd+Shift+R。

## 源码地图
| 位置 | 职责 |
|---|---|
| `server/db.ts` | 建表 + progress 单行读写 + 迁移；支持 `DB_PATH`；导出行类型与 `row()/rows()` 断言助手 |
| `server/routes/{auth,questions,progress,reviews,backup}.ts` | 登录/题库整批替换/进度/复习/整库导出还原 |
| `web/src/lib/pdf/parse.ts`、`extract.ts` | 切题纯函数 / pdfjs 抽文本 |
| `web/src/lib/recite.ts` | 洗牌与进度换算 |
| `web/src/lib/recorder.ts`、`audioStore.ts`、`clipExport.ts` | 录音抽象层 / IndexedDB / 导出 |
| `web/src/lib/speech.ts` | **朗读（TTS）**：切段 + 编排 + 队列播放器，兜住 iOS 手势/15 秒/GC 三个坑 |
| `web/src/lib/api.ts`、`components/ErrorScreen.tsx` | 后端唯一入口（兜网络失败与 401）/ 整页失败态 |
| `web/src/pages/` | Login / Home / Import / Bank / Recite / ReviewScope / Review / Clips |
| `web/src/styles.css`、`web/src/test-setup.ts` | 设计令牌 CSS Vars / jsdom 补 createObjectURL 与 play |

## 文件约定
`impl-plan.md`(P0–P5+DoD)、`CLAUDE.md`(8 条硬约束红线)、`tech-stack.md`、`project-scope.md`（**需求变更先改这里**）、`design/ued.md`+`prototype.html`、`figma-plugin/`（产出真 Figma 稿的唯一路径；Figma MCP 只读）。
git 主分支 `main`；忽略 `node_modules/`、`dist/`、`.env*`、`certs/`、`/pdf/`。
⚠️ **gitignore 目录规则必须带前导斜杠**：旧版写 `pdf/` 把 `web/src/lib/pdf/` 一起吞了，换机器后构建全红。

## 自动阅读（TTS，2026-10-17 做完）
背诵页「自动阅读」开关：题目 → 停 3 秒 → 答案，语速 1.0x（先写死）。**只做背诵页**。引擎是 iOS 内置 `speechSynthesis`。
⚠️ 三个 iOS 约束：① 首次 speak 必须在点击的同步栈里 → toggle 里同步 play，不能交给 useEffect
② 记住的开关刷新后不能自动播（同样不在手势栈）→ 用 `speechArmed` + 一次性 `pointerdown` 里同步念第一句解锁
③ 连播 15 秒被系统掐断 → 9 秒 `pause/resume` 心跳，且只在 `speaking && !paused` 时做；utterance 必须全程持有引用防 GC。
**锁屏/后台朗读做不了**（TTS 不产生音频会话，与内置 TTS 互斥）——要后台只能服务端预生成 MP3 + `<audio>` + MediaSession，方案已写进 `project-scope.md` 五。
⚠️ **全量换 TTS 引擎不可行**：题库 11.4 万字、答案平均 553 字/题 → 全量音频约 424 分钟 / **99 MB**。要换只能按需生成+缓存。

## 服务端 TTS（2026-10-18 做完，已成为首选音源）
`server/tts.ts` + `server/routes/tts.ts` + `web/src/lib/cardAudio.ts`。引擎 **`node-edge-tts`**（微软 XiaoxiaoNeural）。
**线上沙箱确认能联网调微软**。题目 ~1s/25KB，答案 ~2s/632KB（线上首次慢些），缓存命中 0.01~0.6s。
用 `<audio>` 播 + MediaSession → **锁屏/后台也能听**（内置 TTS 做不到的那条由此解决）。
- ⚠️ 引擎选型踩过坑：**`edge-tts-universal` 会卡死**，别用；`node-edge-tts` 可用（默认 timeout 只有 10s，要调大）。
- ⚠️ **必须预取**：iOS 上 `<audio>` 首次出声同样要在手势同步栈里，await 完再 play 静默失败。
- ⚠️ 缓存吃内存（答案 600KB/段）→ 进背诵页 `resetServerAudio()` 清一次；blob 缓存是模块级单例，**测试间会串味**。
- ⚠️ **本地测完必须删 `data/tts/`**，否则会跟着发布一起上传。
- 服务端不通时返回 503 → 前端自动退回内置 TTS，不会没声音。
- ⚠️ **别要求「题目+答案都到齐」才用服务端音频**：答案要 7 秒，那样几乎永远赶不上 → 整卡退回本机朗读
  （症状「电脑上是 Xiaoxiao，手机上是 Siri」）。题目一到就播，答案后补。
- ⚠️ **别做「失败 N 次就禁用整场会话」**：手机上网络抖一下就永久退回机械音。每题重新试即可。
- ⚠️ **src 用真实 URL 不用 blob**：iOS 对 blob 音频不稳，且不利于锁屏播放。预取只是把响应塞进 HTTP 缓存
  （`warmSegment` 必须读完 `arrayBuffer` 才会进缓存）。
- ⚠️ `onDone`（念完回调）会**捕获开播那一刻的 state** → 连播开关要读 ref，不能读 state。
- UI 上有「云端音质 / 本机朗读」小字指示音源 —— 排查音质问题时靠它定位。
⚠️ **音色两个坑**：① iOS `getVoices()` 首次返回空 → 必须在进页面时 `primeVoices()` 预热并监听 `voiceschanged`，
否则挑不到中文音色，系统会拿英文音色念中文（听起来格外怪）② `pickVoice()` 打分要让**增强/高级音色**优先，
但语言精确匹配的分必须压过它（用 zh-TW 念简体音调是错的）。用户嫌机械时，先让他在 iPhone 装增强中文语音
（设置 → 辅助功能 → 朗读内容 → 声音 → 中文 → 增强），零成本且改善明显。

## 本 worktree 环境（2026-10-17 首次跑通）
新 worktree 三件事要补：`npm install`（约 80s）、建 `.env`（APP_ACCOUNT/APP_PASSWORD/SESSION_SECRET，缺了服务 exit 1）、
跑 e2e 前先 `npm run build`（无 `web/dist` 时根路径 404 → `webServer.url` 判定未就绪）。
⚠️ `pdf/` 题库原件被 gitignore，本 worktree 没有 → `import/bank/zz-backup` 三个 e2e spec 必挂，**不是代码问题**。

## 状态与待办
- P0–P5 全部完成并上线；真机已验。
- **后端磁盘持久性未验证**（重发后 SQLite 是否还在）。线上有真实数据（200 题 + 进度 + 7 条复习记录）。
- 2026-10-19：**登录安全加固 P0 完成**（`server/loginLimit.ts` 按账号限流：15 分钟 5 次失败锁 10 分钟，429+Retry-After；失败/锁定打日志）+ **SESSION_SECRET 换强随机**。本地 `.env` 已建。
- 2026-10-19：**server 全量迁移 TS**（18 个文件 .js→.ts，零构建直跑，`tsconfig.server.json`）。已于 2026-10-20 提交 `c4a7754` 并推送 origin/main（push ≠ 部署，线上仍跑旧 startCmd，待发布，注意 Node ≥22.18）。- 语音转文字（暂缓）：iOS Safari `webkitSpeechRecognition`，必须 Safari + HTTPS + 联网，**只能实时听麦不能转写文件**。
- 明确不做：错题清单 / 按章节选范围（要做先改 `project-scope.md`）。
- 2026-10-17：用户在提**背诵页 TTS 自动朗读题目与答案**的需求（待定方案）。
- 2026-10-19：**背诵页「AI 回答重点」上线**（GLM-4.7-Flash，OpenAI 兼容）。详见 `server/llm.ts` + `server/routes/keypoints.ts` + `web/src/components/KeyPointsPanel.tsx`。
  - **已上线并配好 key**（2026-10-19）：startCmd 内联 `LLM_API_KEY=...`（用户给的智谱 key，形如 `xxxx.yyyy`）。不配则静默不显示重点、不报错。默认 `LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4`、`LLM_MODEL=glm-4.7-flash`。
  - 免费档**单并发 1 请求** → `server/llm.ts` 用 `serialize()` 把所有模型调用排队；同一题并发用 `inflight` Map 去重，只生成一次。
  - ⚠️ **智谱 GLM-4.7-Flash 免费档严重限流（根因级）**：两种 429 交替出现——`1302「账户已达到速率限制」`+ `1305「模型访问量过大」`，按分钟限流。
    - **症状**：快速翻卡时每题都立刻打一次 `/api/keypoints/:seq`，突发流量把免费额度瞬间打爆 → 整批 502 刷控制台。
    - **已修（2026-10-19）**：① 前端 keypoints 自动生成加 **600ms 防抖**（`Recite.tsx`/`Review.tsx`：停在某题才生成、翻走 `AbortController` abort、同一题只自动生成一次）；② `server/llm.ts` 对 **429/5xx/超时/网络** 自动重试（`MAX_ATTEMPTS=3`、`BACKOFF_MS=2500` 退避，熬过按分钟窗口），只有 400/401/403 不重试。
    - **仍存的模型侧限制**：高峰时单题孤立生成也可能偶发 502（非代码 bug）。前端 fail-soft 显示「生成失败 + 重试」；生成成功后落库，之后翻回直接读缓存不再调接口。
    - **根治选项（待用户选）**：(a) 换付费智谱模型（如 glm-4-plus，改 `LLM_MODEL`+可能 `LLM_BASE_URL`，一行配置）；(b) 写「整库预生成」脚本，按节奏（长退避）把 200 题重点一次性缓存，背诵时 100% 离线不调接口。
  - 线上验证过：登录 200、题数仍 200（数据未丢）、`/api/keypoints/1` 真实返回要点、二次 GET 命中缓存。
  - 重点落库 `keypoints(seq, points JSON, source['ai'|'user'], updated_at)`；换题库时随 `questions` 一起清。
  - `parsePoints()` 必须能吞掉中文中点 `·`(U+00B7) / `•`(U+2022) / 编号前缀，否则模型输出的 `· ` 会原样进列表。
  - **复习页对照答案时（stage==='compare'）也亮出同一份重点**，可编辑/重新生成，复用 `KeyPointsPanel` + 相同的加载/保存逻辑。⚠️ 必须等 `stage==='compare'` 才加载+渲染 —— 重点从答案提炼，对照前出现等于提前泄底，违背复习页「答案进 compare 才进 DOM」的红线（`web/src/pages/Review.tsx`）。

## 演示视频（2026-10-19，demo/ 目录）
- 方案参考 myresume/jplearn：一条 Playwright test = 一条 screencast webm，自绘触摸点，ffmpeg/gifski 转 MP4/GIF，片头卡片拼接成 `demo/output/full/demo-full.mp4`（约 104s，5 条片段）。
- 命令链：`npm run build` → `npx playwright install ffmpeg` → `npm run demo:pdf` → `npm run demo` → `npm run demo:convert`。详见 `demo/README.md`。
- 三方隔离：端口 3300 / 库 `demo/.db/demo.db` / 账号 demo（webServer 内联注入，不读 .env）。产物 gitignore：`demo/output/ .db/ .auth/`；素材 `demo/assets/`（PDF+音频）进仓库。
- 演示 PDF 由 `gen-demo-pdf.mjs` 现画（字号台阶 9.65/8.25px 匹配 parse.ts），60 题 0 告警；AI 重点/TTS 全部 mock（禁打真实 GLM）。
- **最坑的一条：demo 配置里不能开 `isMobile:true`** —— 移动模拟压窄渲染宽度，screencast 按 390×844 录出来右侧一条黑边。保留 `hasTouch:true` 即可。
