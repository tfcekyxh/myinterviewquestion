# 面试题背诵 · 技术栈方案 v2

> 依据 `project-scope.md`（需求）与 `design/ued.md`（设计）产出。
> **v2 变更**：用户后端为 Express → SQLite 从「浏览器里」改到「服务端」，登录改为自建。
> v1 已被本版取代。

---

## 一、架构

```
iPhone Safari ──HTTPS──▶ Express（单进程 / 单端口）
                          ├─ GET  /*              静态托管 Vite 构建产物
                          ├─ POST /api/login      登录
                          ├─ GET  /api/questions  题库
                          ├─ GET  /api/progress   进度
                          └─ POST /api/reviews    复习记录
                              │
                              ▼
                          SQLite 文件（node:sqlite，Node 内置）
```

**两条被 v1 卡住的问题，v2 自动消失了：**

| v1 的问题 | v2 的情况 |
|---|---|
| iOS 7 天不访问会清掉本地存储 | ✅ 不在手机上，不存在这个问题 |
| 换手机进度就没了 | ✅ 数据在服务端，登录即可接着背（决策 5 重新满足） |
| 必须绕 COOP/COEP、必须跑在 Worker | ✅ 都不需要了 |

**同时不再依赖 WorkBuddy 云服务**（登录、数据库都在自己的 Express 里）。

---

## 二、选型清单

| 层 | 选型 | 备注 |
|---|---|---|
| 服务端 | **Express 5** | 你的既定选择 |
| 数据库 | **`node:sqlite`（Node 内置）** | 见第三节，**不用装任何包** |
| 密码哈希 | **`node:crypto` scrypt** | Node 内置，见第四节 |
| 会话 | **express-session + 自写 SqliteStore（约 40 行）** | 已端到端验证 |
| 前端构建 | Vite + TypeScript | |
| UI | React 19 + TSX | |
| 路由 | react-router-dom **BrowserRouter** + Express 兜底路由 | 有自建服务器，不用再委屈用 hash |
| 样式 | 原生 CSS Variables | 直接映射 `ued.md` 的 13 色 / 7 档字 |
| PDF 解析 | **前端 `pdfjs-dist`**，结果 POST 入库 | 见第八节 |
| 录音 | MediaRecorder → Blob（存本机 IndexedDB 或上传） | 见第七节 |
| 组件测试 | **Vitest + React Testing Library + jsdom** | 见第十一节，已实测跑通 |
| 端到端测试 | **Playwright**（Chromium，假麦克风设备） | 见第十一节，已实测跑通 |

**运行时第三方依赖：express、express-session、react、react-dom、react-router-dom、pdfjs-dist —— 6 个，全部纯 JS、零原生编译。**
（测试依赖另计，不进生产构建。）

---

## 三、最重要的一条原则：所有依赖必须「零原生编译」

这是我重新审视方案后改动最大的地方，也是判断「技术栈好不好」的真正标准。

**原因**：发布沙箱只有一个 HTTP 端口，没有完整的 C/C++ 工具链。任何需要 `node-gyp` 编译的包，在系统不匹配时会尝试从源码编译，而编译需要 Python 3 + GCC/Clang —— **在沙箱里大概率直接失败，且失败时整个部署挂掉**。

这一条淘汰了这些常见选择：

| 常见选择 | 判定 | 原因 |
|---|---|---|
| **better-sqlite3** | ❌ 淘汰 | 原生模块。虽有 8 个平台预编译包，但沙箱 Node 版本一旦不在覆盖范围内就会退回源码编译 |
| **`sqlite3`** | ❌ 淘汰 | 同上 |
| `connect-sqlite3` | ❌ 淘汰 | 我拆包查过：它 package.json 里**没声明**依赖，但源码里 `require('sqlite3')` —— 隐性引入原生模块，装的时候才发现 |
| **bcrypt / argon2** | ❌ 淘汰 | 都需要 node-gyp 编译 |
| `node-sqlite3-wasm` | ⚠️ 备选 | 纯 WASM 无编译，但没必要，Node 自带了 |

**留下的全部是零编译方案。**

### `node:sqlite` 已在本机实测可用

```
node: v22.22.2
require('node:sqlite') → OK，无需 --experimental-sqlite flag
```

Node 22.5+ 内置（`22.22` 实测通过）。它编译在 Node 二进制里，**没有任何平台相关的原生插件**，第三节描述的那一整类问题从根上不存在。

API 是同步的，够用且简单：

```js
const { DatabaseSync } = require('node:sqlite')
const db = new DatabaseSync('data/app.db')
db.exec('CREATE TABLE IF NOT EXISTS questions (...)')
db.prepare('SELECT * FROM questions WHERE id=?').get(id)
```

> 唯一提醒：它标注为 experimental，未来 API 可能微调。本项目只有 4 张表，影响面很小；真要换 better-sqlite3 时，SQL 语句完全不用改。

---

## 四、登录方案（重点）

### 4.1 三个候选

| 方案 | 第三方依赖 | 评价 |
|---|---|---|
| **express-session + 自写 SqliteStore** | express-session | ✅ **推荐**。服务端有状态，登出即失效，Cookie 天然 HttpOnly |
| JWT（`jose`，零依赖） | jose | 单用户单体应用是过度设计：登出难、过期要自己续期。**除非以后要做小程序/多端**才值得 |
| Passport + passport-local | passport, passport-local | 为「多策略并存」设计，你只要一种登录方式，白付复杂度 |

**推荐第一个。** session 存在 SQLite 里，和主库同一个文件，不用额外维护任何东西。

### 4.2 密码存什么、怎么比

| 方案 | 需要编译 | 评价 |
|---|---|---|
| **`node:crypto` scrypt** | 否 | ✅ **推荐**。Node 内置、内存硬、抗 GPU/ASIC 暴力破解 |
| bcrypt | 是 | ❌ 同上淘汰理由 |
| argon2 | 是 | ❌ 同上 |
| pbkdf2 | 否 | 可行，但弱于 scrypt |

```js
// 存：随机盐 + 派生哈希
const salt = crypto.randomBytes(16)
const hash = crypto.scryptSync(password, salt, 64)   // 存 salt 与 hash

// 比：必须用定长时间比较，防时序侧信道
crypto.timingSafeEqual(hash, storedHash)
```

### 4.3 「单一账号、不开放注册」怎么做

- **不写注册页面**，这就是「不开放注册」的全部实现。
- 账号凭证放 `.env`（**已加进 `.gitignore`，不进仓库**）：
  ```
  APP_ACCOUNT=you@example.com
  APP_PASSWORD=初始化用的明文密码（仅首次启动时读）
  ```
- 首次启动时脚本把明文转成 scrypt hash 写进 `users` 表，之后只比对 hash。密码本身的明文不落库、不进代码。

> 注意：云服务 Auth **不支持自定义用户名**，之前的方案被迫要求登录框填邮箱。自建登录后可以恢复成你喜欢的任意账号名 —— `ued.md` S0 那个「账号」输入框保持原样即可。

### 4.4 已经端到端验证过了

不是纸面方案，下面每一步都实跑通过：

```
1. scrypt 正确密码:              true
2. scrypt 错误密码:              false
3. 未登录访问受保护接口:          401
4. 错误密码登录:                 401
5. 正确密码登录:                 200 | Set-Cookie 存在 | HttpOnly: true
6. 带 Cookie 访问受保护接口:      200 {"userId":1}
7. sessions 表落库:              1 行（持久化到 SQLite 文件）
```

只用 `express` + `express-session` + Node 内置模块，零原生依赖。

### 4.5 部署到反向代理后面必须加这一行

```js
app.set('trust proxy', 1)   // 缺了这行，HTTPS 下 secure Cookie 会静默失效，登录后反复掉线
```

这是托管环境里最经典的坑：不加它，Express 认为请求是 HTTP，`secure: true` 的 Cookie 不会被下发，**表现是"登录成功但一刷新就掉线"**，非常难查。

Session Store 的实现（已验证，约 40 行）：

```js
class SqliteStore extends session.Store {
  get(sid, cb) {
    const row = db.prepare('SELECT data, expires FROM sessions WHERE sid=?').get(sid)
    if (!row) return cb(null, null)
    if (row.expires < Date.now()) return this.destroy(sid, () => cb(null, null))
    cb(null, JSON.parse(row.data))
  }
  set(sid, sess, cb) {
    const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime()
                                     : Date.now() + 7 * 864e5
    db.prepare('INSERT OR REPLACE INTO sessions (sid,data,expires) VALUES (?,?,?)')
      .run(sid, JSON.stringify(sess), exp)
    cb(null)
  }
  destroy(sid, cb) { db.prepare('DELETE FROM sessions WHERE sid=?').run(sid); cb(null) }
}
```

---

## 五、表结构

```sql
users     id / account / pwd_hash / pwd_salt
questions id / seq / question / answer / source_pdf
progress  id / mode / position / total / updated_at
reviews   id / question_id / duration_ms / audio_path / created_at
meta      key / value
sessions  sid / data / expires
```

单用户，`owner_id` 不需要 —— 唯一账号天然隔离。

---

## 六、Express 与前端怎么组合（有硬约束）

发布沙箱只给**一个端口**，所以 Express 必须**同时**干两件事：托管前端构建产物 + 提供 API。不能前后端分开部署。

```js
app.use('/api', apiRouter)                    // 1. API 先注册
app.use(express.static('dist'))               // 2. 再托管静态产物
app.get('*', (req, res) =>                    // 3. 兜底给 index.html
  res.sendFile(path.resolve('dist/index.html')))
```

顺序不能颠倒：**兜底路由必须放在最后**，否则会把 `/api/*` 也吞掉。

于是前端可以用干净的 **BrowserRouter**（`ued.md` 里的 `/recite`、`/review` 能直接用），不必委屈成 hash 路由。

本地开发时 Vite 代理到 Express：

```ts
server: { proxy: { '/api': 'http://localhost:3000' } }
```

启动必须这样写（发布沙箱的硬性要求）：

```js
const port = process.env.PORT || 3000
app.listen(port, '0.0.0.0')   // 必须绑 0.0.0.0，必须读 PORT
```

---

## 七、录音：现在多了一个选项，但我不建议立刻用

有了服务端，录音可以上传。但先算一笔账：

```
240 题 × 每题 60 秒 × AAC 约 64kbps ≈ 8 KB/s × 60s ≈ 480 KB/条
240 条 ≈ 115 MB
```

而沙箱的磁盘配额**未经验证**（见第九节）。所以：

- **默认仍存本机 IndexedDB**，回放速度最快、不占服务端配额
- 另做一个「复习录音是否上传服务端」开关，默认关
- 真要上传，建议只保留最近 N 条（比如 30 条 ≈ 15 MB），更早的自动清理

---

## 八、PDF 解析放在哪

**放在前端。** 理由：文件选择器本来就在浏览器里，`pdfjs-dist` 在浏览器是它的一等公民场景，行为确定；而在 Node 里跑 `pdfjs-dist` 需要额外 polyfill，是个待验证项。

流程：手机上选 PDF → 浏览器端 `getTextContent()` 抽文本 → 按排版切题 → 预览（对应 `ued.md` S3）→ 确认后 POST 整批入库。

一次解析、终身有效，后续每次背题都直接从服务端取，不用再解析。

---

## 九、唯一还没验证的风险：磁盘是不是持久的

发布环境文档明确说了：**SQLite 是被支持的**（甚至推荐把存储放在应用内部），并且重新发布会复用同一个沙箱。

**但「重新部署后 SQLite 文件还在不在」这一点，文档没有给出保证，我必须诚实标注为未验证。**

验证成本很低，部署后三步就能确认：

1. 部署上线，导入题库
2. 再发布一次
3. 看题库还在不在

**如果不在**，兜底方案是加一个「导出/导入题库 JSON」按钮（本来也建议有）。这是 `project-scope.md` 里唯一还需要实测的点 —— 其余全部已在本机跑通。

> 补充：这也意味着 MySQL / PostgreSQL / Redis 在发布环境里**直接不可用**（会被告知项目不支持发布）。你要的 SQLite 恰好是环境唯一支持的关系型数据库，这个选择是对的。

---

## 十、安装与目录

```bash
# 服务端（2 个）
npm i express express-session

# 前端
npm create vite@latest web -- --template react-ts
cd web && npm i react-router-dom pdfjs-dist

# 测试（详见第十一节）
npm i -D vitest jsdom @testing-library/react \
         @testing-library/jest-dom @testing-library/user-event @playwright/test
```

```
myInterviewQuestion/
├── server/
│   ├── index.js        入口：PORT + 0.0.0.0（必须）
│   ├── app.js          trust proxy / session / 路由挂载顺序
│   ├── db.js           node:sqlite 连接 + 建表
│   ├── auth.js         scrypt + 登录路由（已验证）
│   ├── sessionStore.js 自写 SqliteStore（已验证）
│   └── routes/         questions / progress / reviews
├── web/                Vite + React
│   ├── src/lib/recorder.ts  录音接口（组件测试用桩替换，见 11.5）
│   ├── src/**/*.test.tsx    L1 组件测试
│   ├── vitest.config.ts
│   └── dist/           → 由 Express 托管
├── e2e/                L2 端到端（playwright.config.ts + *.spec.ts）
├── data/               app.db / test.db（都不进 git）
└── .env                APP_ACCOUNT / APP_PASSWORD（不进 git）
```

`.gitignore` 追加：`data/`、`*.db`、`.env`、`test-results/`、`playwright-report/`

---

## 十一、测试策略：RTL 做组件测试，Playwright 做 e2e

> 本节所有配置与结论**均已在本机实跑验证**（见 12.6 的实测输出），不是纸面方案。

### 12.1 三层验证，各管一段

| 层 | 工具 | 跑在哪 | 覆盖什么 |
|---|---|---|---|
| **L1 组件 / 交互** | Vitest + React Testing Library + jsdom | 本地秒级 | 单个组件的状态机与渲染分支 |
| **L2 端到端** | Playwright（Chromium + 假麦克风） | 本地分钟级 | 全链路，含真实浏览器行为与录音 |
| **L3 真机** | 手动清单（5 项） | iPhone Safari | iOS 特有行为 —— **唯一无法自动化的部分** |

L3 不能省。原因见 12.9：**Playwright 跑不出真正的 iOS Safari**。

### 12.2 依赖（版本均已实测）

```bash
npm i -D vitest @vitest/coverage-v8 jsdom \
         @testing-library/react @testing-library/jest-dom @testing-library/user-event \
         @playwright/test
```

| 包 | 实测版本 | 作用 |
|---|---|---|
| `vitest` | 5.0.3 | 测试运行器 |
| `jsdom` | 30.1.2 | 提供 DOM 环境 |
| `@testing-library/react` | 16.3.3 | 组件渲染与查询（支持 React 19） |
| `@testing-library/jest-dom` | 7.0.1 | `toBeInTheDocument` 等断言 |
| `@testing-library/user-event` | 14.6.7 | 模拟真实用户操作 |
| `@playwright/test` | 1.64.0 | e2e |

### 12.3 为什么是 Vitest 而不是 Jest

Vite 项目用 Jest 需要额外配 `babel-jest` 或 `ts-jest` 才能吃 TSX；**Vitest 直接复用 `vite.config.ts` 的转译管线，零额外配置**。同样是 RTL 写法，少一整套构建胶水。

### 12.4 组件测试该测什么（针对本项目）

**优先测这五处**——都是"错了会直接毁掉产品价值"的地方：

1. **复习三阶段的硬约束（最重要）**
   `ued.md` 定了一条硬规则：进入「对照答案」之前，界面上不允许存在任何能看到答案的入口。这条必须锁死，否则复习就退化成背诵了。断言方式要狠一点——**查整个 DOM 文本**，而不只是查某个节点：

   ```tsx
   expect(visibleText()).not.toContain(ANSWER)
   ```

   ⚠️ **但不要直接写 `document.body.textContent`** —— 实测踩到：如果页面里有**内联 `<script>`**（fixture、内联 mock、某些模板写法），`textContent` 会把**脚本源码也算进去**，于是哪怕 UI 上完全看不到答案，断言也会永远失败。正确做法是先剔除脚本类节点：

   ```ts
   const visibleText = () => {
     const clone = document.body.cloneNode(true) as HTMLElement
     clone.querySelectorAll('script,style,template').forEach((n) => n.remove())
     return clone.textContent ?? ''
   }
   ```

   （Vite 构建产物里的 script 是外链 `src=...`，不含内联源码，所以 RTL 里通常可以直接用 `document.body.textContent`；但只要页面里出现过内联脚本，就必须用上面的写法。）

2. **顺序 / 随机切换**：切到随机后题序确实被打乱，切回顺序后恢复原序（对应决策 3 的"层层递进"）
3. **解析结果预览（S3）**：题目条数、待确认项标记、逐条预览渲染正确
4. **空状态（S1b）**：没导入题库时首页显示引导，而不是一片空白
5. **进度与题号**：刷新后位置正确、数字渲染不跳

**不要测**：CSS 具体像素值（那是视觉回归的活，本项目不做）；组件内部 state；实现细节（否则一重构测试就红）。

### 12.5 录音必须抽一层，否则组件测试写不了

这一点是实测出来的，不是推测：

```
jsdom 环境能力探测：
  MediaRecorder          → undefined
  navigator.mediaDevices → undefined
```

jsdom **既没有 `MediaRecorder` 也没有 `navigator.mediaDevices`**。所以录音逻辑不能直接写在组件里，必须抽成可替换的模块：

```ts
// src/lib/recorder.ts —— 组件只依赖这个接口
export interface Recorder {
  start(): Promise<void>
  stop(): Promise<{ blob: Blob; mimeType: string; durationMs: number }>
}
```

- **组件测试**：`vi.mock('./recorder')` 换成假实现，专注测状态流转
- **e2e**：用真实实现，在 Chromium 里跑真录音（见 12.6）

### 12.6 Playwright 配置（已跑通，含 4 个真实踩到的坑）

```ts
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    channel: 'chromium',             // ★ 坑 5：headless shell 是独立组件，不一定装了
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',  // 用合成音频设备，无需真麦克风
        '--use-fake-ui-for-media-stream',
      ],
    },
  },
  projects: [{
    name: 'mobile',
    use: {
      browserName: 'chromium',        // ★ 坑 1：必须显式写
      ...devices['iPhone 13'],
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    },
  }],
  webServer: {
    command: 'npm run start:test',    // ★ 坑 2：必须是 .cjs 或 ESM 写法
    url: 'http://127.0.0.1:3100',     // ★ 坑 3：URL 必须返回 <400
    reuseExistingServer: !process.env.CI,
  },
})
```

**实测输出：**

```
Running 1 test using 1 worker
  录音产出: recorded:audio/mp4;codecs=opus:11192
  1 passed (3.5s)
```

#### 五个坑（都是真踩到的，不是理论）

| # | 坑 | 表现 | 解法 |
|---|---|---|---|
| 1 | `devices['iPhone 13']` **默认把浏览器切成 WebKit** | 报 `Executable doesn't exist at .../webkit-2370` | 在 `...devices` **之前**写 `browserName: 'chromium'`，或 `npx playwright install webkit` |
| 2 | 项目 `package.json` 有 `"type": "module"` | 服务端 `.js` 用 `require` 会报 `require is not defined` | 服务端文件用 `.cjs`，或整体改 ESM 写法 |
| 3 | `webServer.url` 探测根路径，**404 也算未就绪** | 干等 20 秒后 `Timed out waiting` | 确保 `/` 返回 200（Express 兜底路由要生效） |
| 4 | 浏览器 build 版本必须与 Playwright 版本匹配 | 缓存的 1243 配 Playwright 1.64（要 1248）会直接失败 | `npx playwright install chromium` |
| 5 | **`chromium_headless_shell` 是独立组件**，`install chromium` 不等于装了它；安装中途失败时更会被漏掉 | 报 `Executable doesn't exist at .../chromium_headless_shell-1248` | 要么 `npx playwright install chromium-headless-shell`，要么在 `use` 里加 **`channel: 'chromium'`**（直接用完整 Chromium，已实测通过） |

> 上面第 5 条就是本机真实情况：`install chromium` 在下载 **ffmpeg** 那一步失败（ffmpeg 只用于录制视频，本项目用不到），导致排在其后的 headless shell 没被装上；好在完整 Chromium 已经装好了，加 `channel: 'chromium'` 即绕开。

> 另一段本机插曲：`npx playwright install` 曾一直报 `EEXIST: __dirlock`。原因是 `~/Library/Caches/ms-playwright/__dirlock` 有个**10-04 留下的陈旧空锁目录**（Playwright 自己创建的锁没被清掉）。已用 `rmdir` 清掉（只对空目录生效）。**以后再遇到同样的报错，就是这个原因。**

#### 一个对录音实现有直接影响的发现

Chromium 选的是 **`audio/mp4;codecs=opus`**，不是 `audio/webm`。也就是说：

> **不能把录音文件的扩展名写死成 `.webm`。** 存文件、上传、回放时必须用 `recorder.mimeType` 推导扩展名，否则 iPhone 上（出 `audio/mp4`）会存出打不开的文件。

### 12.7 e2e 该测什么

跑**完整链路**，而不是每个页面点一遍：

1. 登录（错误密码 → 401；正确 → 进入）
2. 导入 PDF → 解析结果页显示条数
3. 背诵：下一题 / 上一题 / 切随机
4. **复习：答案隐藏 → 录音 → 对照答案**（已验证可跑）
5. 刷新页面 → 进度还在（验证服务端 session + 进度落库）

**数据库必须隔离**：`NODE_ENV=test` 时指向 `data/test.db`，每个用例前重建表，**绝不能碰 `data/app.db`**。

### 12.8 目录与命令

```
myInterviewQuestion/
├── server/
├── web/
│   ├── src/
│   │   ├── lib/recorder.ts        录音接口（组件测试用桩替换）
│   │   ├── test-setup.ts          import '@testing-library/jest-dom/vitest'
│   │   └── components/*.test.tsx  ← L1 组件测试
│   └── vitest.config.ts
└── e2e/                           ← L2 端到端
    ├── playwright.config.ts
    └── *.spec.ts
```

```json
"scripts": {
  "test":       "vitest run",
  "test:watch": "vitest",
  "test:e2e":   "playwright test",
  "start:test": "NODE_ENV=test node server/index.js"
}
```

### 12.9 必须说清楚的限制：Playwright 跑不出真 iOS Safari

**这一点决定了 L3 不能省。** Playwright 提供的 WebKit 是 **macOS 版 WebKit**，和 iOS Safari 不是一回事；即便装了它，下面这些也测不出来：

- iOS Safari 的 `MediaRecorder` 实际行为与 mimeType
- 麦克风 / 语音识别**授权弹窗**的真实流程
- `secure` Cookie 在 HTTPS + 反向代理下的表现（对应第四节那个 `trust proxy` 坑）
- `safe-area-inset` 与安全区适配
- 手势、滚动惯性、输入法遮挡

所以保留一份**真机手动清单**，每次改动后花两分钟过一遍：

- [ ] Safari 打开首页，未登录会被拦
- [ ] 登录后刷新不掉线
- [ ] 复习页面点录音，弹窗出现且能授权
- [ ] 录完能回放，听到的是自己的声音
- [ ] 底部按钮不被 Home 指示条遮挡

---

## 十二、待你拍板

1. **账号名**：想用什么？（邮箱 / 自定义用户名都行 —— 自建登录没有限制）
2. **录音上传要不要做**：倾向先只存本机，把磁盘风险留给第九节验证之后再决定
3. **云服务还留着吗**：现在这套方案已经不依赖它了。留着不占配额，不用也可以不管；要彻底不用我可以把相关文档标注清理掉
