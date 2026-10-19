# 演示视频录制（demo/）

用 Playwright 录产品功能演示视频。方案参考同级项目 myresume / jplearn 的 demo/ 目录：
一条 test = 一个 context = 一条 webm（`page.screencast` 显式开关），自绘触摸点，
转码出 MP4 + GIF，最后拼一条带片头卡片的完整视频。

## 快速开始

```bash
npm install                  # 首次（约 2 分钟）
npm run build                # 必须：web/dist 缺失时服务根路径 503
npx playwright install ffmpeg # 录制依赖 Playwright 自带的 ffmpeg（screencast 落盘）
npm run demo:pdf             # 生成演示题库 PDF（demo/assets/，已随仓库提交）
npm run demo                 # 录 5 条片段（约 2 分钟，自动起服务 + 播种数据）
npm run demo:convert         # 转 MP4/GIF + 片头卡片 + 拼接完整视频
```

转码依赖系统 ffmpeg 与 gifski：`brew install ffmpeg gifski`。

## 片段清单

| id | 内容 | 时长 |
|---|---|---|
| 01-login-home | 登录 → 首页进度卡（已背 18/60） | ~9s |
| 02-import | 题库管理 → 重新导入 PDF → 解析 60 题 → 确认入库 | ~16s |
| 03-recite | 翻卡 · AI 回答重点 · 随机/顺序 · 自动阅读（云端音质）· 刷新进度不丢 | ~26s |
| 04-review | 复习范围（刚背完的一轮）→ 按住录音 → 对照答案/回放/重点 → 下一题答案重藏 | ~24s |
| 05-clips-bank | 我的录音（IndexedDB 播种 + 回听）→ 题库管理导出 JSON | ~18s |

拼接后的完整视频约 104s（5 张 2.5s 片头卡片 + 片段），产物在 `demo/output/`：

```
demo/output/
  raw/<片段>.webm      screencast 原始录制
  clips/<片段>.mp4     交付用（libx264 crf20 yuv420p faststart，无音轨）
  clips/<片段>.gif     内嵌文档用（gifski 12fps 390px 宽）
  full/card-*.png      片头卡片（Chromium 渲染，配色对齐 styles.css 设计令牌）
  full/demo-full.mp4   完整演示视频
```

## 隔离设计（与 e2e / dev 三方互不干扰）

- 端口 **3300**（e2e 3100，dev 3000/3443）
- 库文件 **demo/.db/demo.db**（e2e data/test.db，dev data/app.db）
- 演示账号 demo/demo1234，webServer 命令内联注入，不读 .env
- `reuseExistingServer: false`：每次录制都是全新库，首页「已背 18/60」这类断言才稳定

## 数据基线（seed-demo.ts 管）

globalSetup 通过 API 灌：题库 60 题（与演示 PDF 同源）+ 进度 18/60 + storageState。
片段 2 导入 PDF 会整批替换题库、进度归零（产品行为）；片段 4 自己造「刚背完的一轮」；
片段 5 自己往 IndexedDB 播种录音（Playwright context 不共享本机存储）。

## 踩过的坑（改之前先看）

1. **`isMobile: true` 会让录屏右侧出现黑边**。移动模拟给页面施加缩放，
   应用实际渲染宽度被压窄，screencast 仍按 390 录 → 右边补黑。
   只要 `hasTouch: true`（触摸事件够用），**不要开 isMobile**。
2. **webServer 的 cwd 是 demo/**（配置文件所在目录），命令里要先 `cd ..`，
   否则 `node server/index.js` 找不到。
3. **Playwright 自带 ffmpeg 要单独装**：`npx playwright install ffmpeg`
   （版本跟 @playwright/test 走，1.64 要 ffmpeg-1013）。
4. **自动阅读开关是 `role="switch"` 不是 button**（Recite.tsx 里 aria-checked），
   定位要用 `getByRole('switch', ...)`。
5. **演示里所有点击走 `moveAndClick`**（滑过去 → 停顿 → 按下抬起）。
   从移动到点击有约 1s 观感停顿，断言/等待短于这个的中间态录不到 ——
   AI 重点的 mock 延迟因此放到 2.6s，回听用的种子音频因此放到 10s。
6. **AI 接口必须 mock**（GLM 免费档按分钟限流）；TTS 用静音 MP3 顶替，
   `<audio>` 链路与线上一致，只是没声音。
7. **转换脚本是 .mjs，不能写 TS 类型注解**（Node 只对 .ts 做类型剥除）。

## 与 e2e 的关系

demo/ 与 e2e 共享登录/题库/进度接口，但互不影响：`npm run test:e2e` 永远看不到
demo/scripts 下的用例（testDir 不同），demo 也绝不碰 data/ 下的库。
