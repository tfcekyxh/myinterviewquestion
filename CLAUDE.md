# CLAUDE.md

把一个题库 PDF 变成手机上能一道一道背的卡片。用户**只用 iPhone**，全程以 iOS Safari 为前提。

## 文档索引（动手前先读，避免与已定结论冲突）

| 文件 | 是什么 |
|---|---|
| `project-scope.md` | 需求与已确认决策（**最终依据**） |
| `design/ued.md` | UED 设计规范：13 色 / 7 档字 / 组件 / 逐屏说明 |
| `tech-stack.md` | 技术栈与部署约束（**技术细节以此为准**） |
| `impl-plan.md` | 分阶段实施方案（P0–P5） |

> 出现过历史方案变更（无后端 → 云服务 → 自建 Express）。**凡遇到「无后端 / 存浏览器本地 / 云服务 Auth」的旧描述，一律以当前文档为准。**

## 架构一句话

```
iPhone Safari ─HTTPS─▶ Express（单端口：托管 dist + /api）─▶ SQLite（node:sqlite）
```

前端 Vite + TypeScript + React 19，**BrowserRouter**（有 Express 兜底路由）。

## 硬约束（红线，违反会直接导致线上故障）

1. **零原生编译依赖。** 发布沙箱没有 C/C++ 工具链。禁止引入 `better-sqlite3`、`sqlite3`、`bcrypt`、`argon2`（`connect-sqlite3` 也禁——它源码 `require('sqlite3')` 却没在 package.json 声明）。数据库用 Node 内置 `node:sqlite`，密码哈希用 `crypto.scrypt`。
2. **必须 `app.set('trust proxy', 1)`。** 缺了会导致 HTTPS 下 secure Cookie 不下发，症状是「登录成功但一刷新就掉线」，极难排查。
3. **路由顺序不可颠倒**：`/api` → `express.static(dist)` → `app.get('*')` 兜底。
4. **启动必须** `app.listen(process.env.PORT, '0.0.0.0')`。
5. **不引 UI 组件库。** 样式用原生 CSS Variables，直接映射 `ued.md` 的令牌值。
6. **录音必须抽成 `src/lib/recorder.ts` 接口**，组件只依赖接口。实测：jsdom 里**没有 `MediaRecorder`、也没有 `navigator.mediaDevices`**，写在组件里就没法写组件测试。
7. **录音文件扩展名绝不能写死 `.webm`**，必须按 `recorder.mimeType` 推导。实测 Chromium 出 `audio/mp4;codecs=opus`，iPhone 出 `audio/mp4`。
8. **复习模式的硬约束**：进入「对照答案」之前，页面上不允许存在任何能看到答案的入口。
   做法是把答案放在 `stage === 'compare'` 的条件里（**根本不进 DOM**），不是用样式藏起来。
9. **`pointerdown` 上绝不能 `preventDefault()`**。实测：取消默认行为会把后续的兼容鼠标事件一起吃掉，
   `pointerup` 再也不来 —— 症状是「按住录音后松手不结束」。防 iOS 长按选中改用 CSS（`user-select` / `-webkit-touch-callout`）。
10. **音频只存本机**（IndexedDB，`src/lib/audioStore.ts`），**不上云**；服务端 `reviews` 只记元数据。
    `audio_path` 存的是本机录音的键，不是服务端路径。

## 测试约定

- **组件测试**：Vitest + React Testing Library + jsdom。改组件必须同步更新测试。
- **端到端**：Playwright。改主流程必须同步更新 e2e。
- **真机**：iPhone Safari 手动清单（`tech-stack.md` 11.9）。**Playwright 跑不出真 iOS Safari**，模拟器通过不等于能用。
- Playwright 已知坑：`devices['iPhone 13']` 默认切 WebKit，需在 `...devices` 之前显式写 `browserName: 'chromium'`；`webServer.url` 探测根路径且 404 算未就绪；headless shell 是独立组件、`install chromium` 不一定装上它（本机即缺）→ 配置里加 `channel: 'chromium'` 绕开。
- **断言"答案没泄露"时，先剔除 `script/style/template` 再取 `textContent`** —— 内联脚本的源码会被算进 `body.textContent`，导致断言永远失败。
- **e2e 各 spec 顺序执行、共用同一个服务与 `data/test.db`**，所以每个 spec 要么自播种数据、要么把依赖初始状态的用例放进 `00-empty.spec.ts`（唯一在全新库上跑的）。
  `recite.spec.ts` / `review.spec.ts` 都会把题库换成自己的 fixture，必须排在 `import.spec.ts` 之后（文件名排序靠后即可）。
- **改了首页/主流程的文案，记得同步 e2e 里的断言** —— 断言写的是可见文本，文案一改就红。
- **用 objectURL 的资源（录音回放）必须在事件处理里一次算好**，放 `useEffect` 里会让 UI 先以禁用态出现一帧。
- `src/test-setup.ts` 给 jsdom 补了 `createObjectURL` 与音频 `play/pause`（jsdom 都没实现），动它要谨慎。

## 数据结构约定

- 时间统一存 **epoch 毫秒整数**，不存字符串日期。
- 单用户，不需要 `owner_id`（唯一账号天然隔离）。
- 表：`users` / `questions` / `progress` / `reviews` / `meta` / `sessions`。
- `progress` 是**单行 JSON**（`id=1` 恒成立）。位置语义是「**已背题数**」，取值 `0..N`，
  取到 `N` 表示这一轮背完了；顺序与随机各存一个位置（`posOrder` / `posRandom`）。
  另有 `roundStart`（这一轮的起点）与 `lastRound`（刚背完的一轮的题号，供复习选范围）。

## 真机调试（录音功能必须这么测）

**Safari 只在安全上下文（HTTPS 或 localhost）下才允许访问麦克风**，而手机上的 localhost 是手机自己，
所以「用 localhost 绕过」不存在。手机打开 `http://192.168.x.x:3000` 会因为不是 HTTPS 被直接拒绝 ——
`navigator.mediaDevices` 根本是 undefined，代码跑都跑不到，也不会有任何弹窗。

```bash
npm run cert:gen     # 生成 certs/dev.{crt,key,cer}，SAN 自动带上本机所有局域网 IP
npm run dev:https    # HTTP(:3000) + HTTPS(:3443) 一起起
```

然后手机上：先用 Safari 打开 `http://<本机IP>:3000/__dev/cert.cer` 装描述文件，
**再去「设置 → 通用 → 关于本机 → 证书信任设置」把开关打开**（不做这步 Safari 会一直说无法建立安全连接），
最后打开 `https://<本机IP>:3443`。

- HTTPS **只在 `HTTPS=1` 时才启动**。不这么做的话 e2e 每次都会去抢 3443，上一轮没退干净就 EADDRINUSE。
- `certs/` 已在 `.gitignore` 里，私钥绝不进仓库。
- 换 Wi-Fi / IP 变了要重新 `npm run cert:gen`（SAN 里写死了旧 IP）。

## 命令

```bash
npm run dev          # 前端（Vite，/api 代理到 :3000）
npm run dev:server   # 后端（HTTP）
npm run dev:https    # 后端 + 真机调试用的 HTTPS
npm run cert:gen     # 生成自签证书
npm test             # vitest run（组件测试）
npm run typecheck    # tsc --noEmit（build 现在也会先跑它）
npm run test:e2e     # playwright test
npm run smoke:auth       # 登录接口级冒烟（需先起服务）
npm run smoke:progress   # 进度/复习接口级冒烟（会覆盖题库与进度，建议跑在 NODE_ENV=test 的服务上）
```

本机受管 Node 在 `~/.workbuddy/binaries/node/versions/`；`node:sqlite` 需要 Node 22.5+（22.22.2 实测无需 flag）。

## Git 约定

- 主分支 `main`。commit message 用中文，前缀 `feat:` / `fix:` / `docs:` / `test:` / `refactor:`，正文说明「做了什么、为什么」。
- 每完成一个阶段提交一次，**保持工作区干净**。
- 不进仓库：`.env`、`data/`、`*.db`、`test-results/`、`playwright-report/`。

## 明确不做（本期范围外）

- 开放注册 / 多账号管理（只要一个账号，写在 `.env`）
- 按章节分组选背诵范围
- 「不会」错题清单
- 语音转文字（技术路线已查清，见 `project-scope.md` 第五节）

## 当前卡点

题库 PDF 尚未放进项目目录。它到位前先做 `impl-plan.md` 的 P1（骨架 + 登录），不依赖 PDF。
