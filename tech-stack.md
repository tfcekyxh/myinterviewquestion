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

**总第三方依赖：express、express-session、react、react-dom、react-router-dom、pdfjs-dist —— 6 个，全部纯 JS。**

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
cd web && npm i react-router-dom
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
│   └── dist/           → 由 Express 托管
├── data/               app.db（不进 git）
└── .env                APP_ACCOUNT / APP_PASSWORD（不进 git）
```

`.gitignore` 追加：`data/`、`*.db`、`.env`

---

## 十一、待你拍板

1. **账号名**：想用什么？（邮箱 / 自定义用户名都行 —— 自建登录没有限制）
2. **录音上传要不要做**：倾向先只存本机，把磁盘风险留给第九节验证之后再决定
3. **云服务还留着吗**：现在这套方案已经不依赖它了。留着不占配额，不用也可以不管；要彻底不用我可以把相关文档标注清理掉
