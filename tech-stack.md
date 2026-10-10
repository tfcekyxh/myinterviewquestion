# 面试题背诵 · 技术栈方案 v1

> 依据 `project-scope.md`（需求）与 `design/ued.md`（设计）产出。
> 目标环境：iPhone Safari 竖屏、HTTPS、静态托管。
> 阶段定位：**数据库先用 SQLite（跑在浏览器里），后续迁移到云服务 PostgreSQL。**

---

## 一、一句话方案

**纯静态前端 + 浏览器内 SQLite + 云服务只做登录。** 后面把 SQLite 换成云数据库时，只改一个文件。

---

## 二、选型清单

| 层 | 选型 | 为什么是它 | 否掉的替代 |
|---|---|---|---|
| 构建 | **Vite + TypeScript** | 产物小、冷启动快、构建配置最少 | Webpack（配置重）、Parcel |
| UI 框架 | **React 19 + TSX** | 11 屏有真实状态（进度、录音态、切题），状态驱动比操作 DOM 好维护 | 原生 JS（后期改动成本高）；Vue 也行，但本项目我推荐 React |
| 路由 | **react-router-dom v7，`HashRouter`** | **静态托管没有 history fallback**，`/review` 这种路径会直接 404，只有 hash 路由安全 | BrowserRouter（在静态托管下刷新必 404） |
| 样式 | **原生 CSS Variables + CSS Modules** | `ued.md` 的 13 色 / 7 档字号可以直接 1:1 映射成变量，不引 UI 库就不会偏离设计稿 | Tailwind（类名噪音大，且容易绕过令牌值）；Ant Design Mobile（视觉不是这套） |
| 数据库（v1） | **`@sqlite.org/sqlite-wasm`，用 `opfs-sahpool` 后端** | 见第四节 | sql.js（无持久化）；wa-sqlite（GPL） |
| 认证 | **`@tencent-ai/workbuddy-cloud-sdk@dev` → `cloud.auth`** | 服务端校验，前端代码里没有密码，满足决策 9 | 前端写死密码对比（可被翻源码绕过） |
| PDF 解析 | **`pdfjs-dist` + `getTextContent()`** | 只抽文本层，不渲染 canvas，最轻 | pdf-lib（不擅长提取排版文本）；服务端 OCR（当前方案还没到那一步） |
| 录音 | **`MediaRecorder`（原生）+ IndexedDB 存 Blob** | iOS Safari 原生支持，出 AAC/MP4，无第三方依赖 | RecordRTC（多余的一层封装） |
| 波形 | **Web Audio `AnalyserNode`** | `ued.md` S7 的 24 根竖条靠它 | 假动画 |
| 轻量键值 | **`idb-keyval`** | 存设置、最后的题目位置等小数据 | localStorage（只有 5MB、只能存字符串） |

**总依赖数控制在 8 个以内，全部是成熟稳定包。**

---

## 三、为什么不引 UI 组件库

`ued.md` 里已经把数值定死了：13 个颜色、7 档字号、单一阴影、4 的倍数间距、三种圆角。
引入 UI 组件库等于**再来一套令牌**，之后每个组件都要跟设计稿对齐一遍。这套设计只有 10 个组件，自己写成本低于改造。

---

## 四、SQLite 放在浏览器里：三个必须先知道的点

### 4.1 必须用 `opfs-sahpool`，不能用默认的 `opfs`

官方 SQLite WASM 提供两个 OPFS 后端：

| 后端 | 是否需要服务端响应头 | 能否用在静态托管 |
|---|---|---|
| `opfs`（默认） | 需要 `COOP: same-origin` + `COEP: require-corp`（因为依赖 SharedArrayBuffer） | ❌ 静态托管通常改不了响应头 |
| **`opfs-sahpool`** | **不需要任何额外响应头** | ✅ |

**所以我们用 `opfs-sahpool`。** 这一条决定了整套方案能不能跑起来，选错会在部署后才发现。

已知限制：**同一时刻只允许一个连接。** 第二个标签页打开同一个数据库会失败 → 页面要给出明确提示（"题库已在另一个标签页打开"），而不是静默失败。

### 4.2 SQLite 必须跑在 Worker 里

OPFS 的同步访问句柄只在 Worker 线程可用，主线程开不了持久化的 OPFS 数据库。
所以结构是：`db.worker.ts` 持有数据库，主线程通过 `postMessage`（推荐用 **Comlink**）调用。顺带的好处：解析几百道题时不卡界面。

### 4.3 现在用 SQLite，代价是什么

`project-scope.md` 决策 5 定的是「进度存云端、换手机也能接着背」。**换成浏览器内 SQLite 后，这一条暂时失效**：数据在这台手机上。

这不是障碍，是阶段取舍。**等真正需要跨设备时把 `sqliteRepo.ts` 换成 `cloudRepo.ts` 即可**，第五节的三条约定就是为这个准备的。

---

## 五、为迁移留的三条约定（现在定，成本为零；以后定，等于重写）

### 约定 1：所有数据访问只能走 `src/data/repo.ts`

业务代码（屏幕组件）**永远不 import `sqlite-wasm`，也不 import `workbuddy-cloud-sdk`**，只调 repo 里的方法。迁移时改的是 repo 的内部实现，屏幕代码一行不动。

```ts
// src/data/repo.ts —— 业务层唯一的数据出口
export interface Repo {
  listQuestions(): Promise<Question[]>
  replaceAllQuestions(qs: Question[]): Promise<void>
  getProgress(mode: 'order' | 'random'): Promise<Progress | null>
  saveProgress(p: Progress): Promise<void>
  addReview(r: ReviewRecord): Promise<void>
  listReviews(qid: number): Promise<ReviewRecord[]>
}
```

### 约定 2：所有 repo 方法从第一天起就是 `async`

即使 SQLite 此刻是同步返回，**也必须返回 Promise**。因为明天它是一次网络请求。今天写成同步，迁移时会波及每一个调用点。

### 约定 3：SQL 只写 SQLite 与 PostgreSQL 的交集

| 用法 | 结论 |
|---|---|
| `INSERT` 不写主键，让数据库自己生成 | ✅ 两边一致 |
| 时间字段存 **epoch 毫秒整数**（JS `Date.now()`） | ✅ 避开两边日期函数的差异 |
| 避免 JSON 列 | ⚠️ SQLite 是 `TEXT`，PG 是 `JSONB`，不统一就别用 |
| 避免 `INSERT OR REPLACE` / `ON CONFLICT` | ⚠️ 语法两边不通用，upsert 逻辑写在 JS 里 |
| 避免 `AUTOINCREMENT` | ⚠️ SQLite 专有 |

**表结构**（同一份逻辑，两种建表语句，字段完全一致）：

```
questions   id / seq / question / answer / source_pdf
progress    id / mode / position / total / updated_at
reviews     id / question_id / duration_ms / audio_key / created_at
meta        key / value        （题库名、导入时间等）
```

> 迁移到云数据库后，`progress` / `reviews` 需要加 `owner_id TEXT DEFAULT auth.uid()` 并配 RLS 做按账号隔离。现在 SQLite 里不需要。

---

## 六、录音怎么处理

- **录制**：`MediaRecorder`。iOS 出 `audio/mp4`（AAC）；不要用 `audio/webm`，iOS 18.4 之前不支持。启动时用 `MediaRecorder.isTypeSupported()` 探测，不要猜。
- **存储**：Blob 存 **IndexedDB**（不是 OPFS、不是 localStorage）。录音元数据（`question_id` / 时长 / `audio_key`）存 SQLite，音频本体存 IndexedDB，用 key 关联。
- **回放**：`URL.createObjectURL(blob)` 直接喂给 `<audio>`。离开对照答案页时务必 `revokeObjectURL` 并停掉播放。
- **前置条件**：必须 HTTPS + Safari，且用户授权麦克风。不满足要在页面上明说，不要静默失败（`project-scope.md` 风险二的要求）。

---

## 七、部署：静态托管 + PWA manifest

发布用 Vite 构建产物走静态托管（自带 HTTPS，这是录音和 SQLite 的前提）。

**强烈建议顺手加一个 `manifest.webmanifest` + `<meta name="apple-mobile-web-app-capable" content="yes">`，让用户把网页「添加到主屏幕」。** 原因见下一节。

---

## 八、两个必须提前知道的真实风险

### 风险 A：iOS Safari 的「7 天清理」

**WebKit 的规则**：一个网站连续 7 天（按 Safari 使用天数算）没有任何交互，就会清掉它的全部脚本可写存储——IndexedDB、OPFS、localStorage 一个不留。**这意味着题库和进度可能被清掉。**

三条缓解：
1. **添加到主屏幕**（Home Screen Web App 不受这条规则约束）← 最有效，所以第七节才建议加 manifest
2. 正常使用、定期打开，计时器会重置
3. 加一个「导出题库 JSON」的入口做兜底 —— 题库丢了要重新解析，这是最疼的

这个问题的根源是数据在本地。等迁到云数据库，自然消失。

### 风险 B：登录账号必须是邮箱

`project-scope.md` 决策 9 说「单一账号 + 服务端校验」，云服务的 Auth **支持邮箱+密码、邮箱验证码、手机验证码，不支持自定义用户名**。

所以 `ued.md` S0 登录页那个「账号」输入框，实际要填的是**邮箱**（设计稿占位写的 `kaozhen` 需要改）。这一点需要改设计稿，或接受这个偏差。

「不开放注册」的做法：**前端不放注册入口。** 账号由我们一次性建好后，页面只保留登录。

---

## 九、依赖安装

```bash
# 构建与框架
npm create vite@latest . -- --template react-ts
npm i react-router-dom

# 数据与云端
npm i @sqlite.org/sqlite-wasm
npm i @tencent-ai/workbuddy-cloud-sdk@dev
npm i idb-keyval comlink

# PDF 与录音（后者用浏览器原生 API，无需安装）
npm i pdfjs-dist
```

> `cloud-sdk` 必须装 `@dev` 频道，不要写死版本号。

**Vite 里 worker 的正确写法**（踩坑高发区）：

```ts
// pdf worker
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// sqlite worker（Vite 7 推荐这种）
new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' })
```

---

## 十、目录结构

```
src/
├── main.tsx              入口 + HashRouter
├── cloud.ts              云服务客户端（全项目唯一初始化点）
├── styles/
│   ├── tokens.css        13 色 / 7 档字 / 间距 / 圆角 / 阴影，与 ued.md 一一对应
│   └── base.css
├── components/           Button / Input / Card / Chip / ProgressBar / NavBar / Feedback
├── screens/              S0_Login … S9_Me（一一对应 ued.md 的 Frame）
├── data/
│   ├── repo.ts           ★ 接口定义，业务唯一出口
│   ├── sqliteRepo.ts     v1 实现
│   ├── cloudRepo.ts      v2 实现（先空着）
│   ├── db.worker.ts      SQLite 运行的 Worker
│   └── schema.sql
├── pdf/parse.ts          pdfjs 抽文本 + 按排版切题
├── record/recorder.ts    MediaRecorder + IndexedDB
└── lib/kv.ts             设置项
```

---

## 十一、待你拍板

1. **SQLite 是「第一阶段就用着」，还是「只在开发期跑，上线直接用云数据库」？** —— 前者按本方案走；后者的话 SQLite 只在 node 脚本里作为解析落地的临时库，前端直连云数据库，第五节的三条约定仍然成立但可以简化。
2. **登录用邮箱+密码，还是邮箱验证码？** 倾向邮箱+密码：页面就是 `ued.md` S0 现在那样，不多屏。
3. **`ued.md` S0 的「账号」占位**，要不要我把 `kaozhen` 改成邮箱示例（如 `you@example.com`）并重新生成 SVG / PNG？
