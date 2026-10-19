import { request as playwrightRequest } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  AUTH_STATE_PATH,
  BASE_URL,
  DEMO_ACCOUNT,
  DEMO_DB_PATH,
  DEMO_PASSWORD,
  DEMO_PDF_PATH,
  QUESTION_COUNT,
} from './constants'
import { DEMO_QUESTIONS } from './questions-demo.ts'

/**
 * 录制的基线数据（globalSetup）。
 *
 * 时序：Playwright 先起 webServer（命令里已 rm 掉旧 demo 库 → 服务启动即建库
 * 并建好账号），本脚本再通过 API 灌数据。库文件的建表与账号创建都由
 * server/index.js 启动时自动完成，这里不直接碰 SQLite。
 *
 * 灌三样东西：
 *  1. 题库 60 题（与演示 PDF 同源）—— 让片段 3-5 不依赖片段 2 也能单独跑
 *  2. 进度：已背 18 题 —— 片段 1 的首页进度卡有东西可看
 *  3. storageState —— 片段 2-5 免登录开场
 *
 * 片段 2（导入 PDF）会整批替换题库，进度随之归零，这是产品行为，不是 bug。
 * 片段 4（复习）需要的「刚背完的一轮」由该 spec 自己播种。
 */

/** 录制依赖 Playwright 自带的 ffmpeg（screencast 落盘 webm 靠它） */
function assertRecordingFfmpeg() {
  const cacheDir = resolve(homedir(), 'Library/Caches/ms-playwright')
  const found =
    existsSync(cacheDir) && readdirSync(cacheDir).some((name) => name.startsWith('ffmpeg-'))
  if (!found) {
    throw new Error(
      '缺少 Playwright 自带的 ffmpeg（录制视频必需），先执行：npx playwright install ffmpeg',
    )
  }
}

function assertAssets() {
  if (!existsSync(DEMO_PDF_PATH)) {
    throw new Error(`缺少演示题库 PDF：${DEMO_PDF_PATH}\n先执行：node demo/scripts/gen-demo-pdf.mjs`)
  }
  const dist = resolve(process.cwd(), 'web/dist/index.html')
  if (!existsSync(dist)) {
    throw new Error('前端尚未构建（web/dist 缺失），先执行：npm run build')
  }
}

async function main() {
  assertRecordingFfmpeg()
  assertAssets()

  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL })

  // 1. 登录拿 cookie。webServer 启动时已用内联环境变量建好演示账号
  const login = await ctx.post('/api/login', {
    data: { account: DEMO_ACCOUNT, password: DEMO_PASSWORD },
  })
  if (!login.ok()) {
    throw new Error(`演示账号登录失败：${login.status()} ${await login.text()}`)
  }

  // 2. 题库（与演示 PDF 同源，source 名也用 PDF 文件名，首页信息卡对得上）
  const saved = await ctx.post('/api/questions', {
    data: {
      source: 'Java 面试题速记 60 题（演示）.pdf',
      questions: DEMO_QUESTIONS.map((q) => ({ question: q.question, answer: q.answer })),
    },
  })
  if (!saved.ok()) throw new Error(`播种题库失败：${saved.status()} ${await saved.text()}`)

  // 3. 进度：已背 18 题（位置语义是「已背题数」，首页显示「上次背到第 19 题」）
  await ctx.delete('/api/progress')
  const prog = await ctx.put('/api/progress', { data: { posOrder: 18, roundStart: 0 } })
  if (!prog.ok()) throw new Error(`播种进度失败：${prog.status()}`)

  // 4. storageState 供片段 2-5 免登录开场
  await mkdir(dirname(AUTH_STATE_PATH), { recursive: true })
  await ctx.storageState({ path: AUTH_STATE_PATH })
  await ctx.dispose()

  console.log(
    `[demo:seed] 题库 ${QUESTION_COUNT} 题、进度 18/${QUESTION_COUNT}、免登录状态已写入 ` +
      `（库文件 ${DEMO_DB_PATH}）`,
  )
}

export default main
