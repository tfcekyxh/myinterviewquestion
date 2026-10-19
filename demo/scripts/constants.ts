import { resolve } from 'node:path'
import { DEMO_QUESTIONS, DEMO_PDF_NAME } from './questions-demo.ts'

/**
 * 演示录制的公共常量。
 *
 * 所有 demo 脚本一律从仓库根执行（package.json scripts 就是这么定义的）。
 * 端口 / 库文件 / 数据与 e2e（3100 + data/test.db）和 dev（3000 + data/app.db）
 * 三方隔离：录制会反复重置进度、替换题库，绝不能碰真实数据。
 */

const ROOT = process.cwd()

export const DEMO_DIR = resolve(ROOT, 'demo')
export const SCRIPTS_DIR = resolve(DEMO_DIR, 'scripts')

/** 中间产物与成品。gitignore 已覆盖 output/ 与 .db/ */
export const OUTPUT_DIR = resolve(DEMO_DIR, 'output')
/** 原始 webm（一条片段一个文件） */
export const RAW_DIR = resolve(OUTPUT_DIR, 'raw')
/** 转码后的 GIF / MP4 */
export const CLIPS_DIR = resolve(OUTPUT_DIR, 'clips')
/** 拼接好的完整演示视频 */
export const FULL_DIR = resolve(OUTPUT_DIR, 'full')

/** 演示专用端口：3100 是 e2e，3000/3443 是 dev，都不占 */
export const PORT = Number(process.env.DEMO_PORT ?? 3300)
export const BASE_URL = process.env.DEMO_BASE_URL ?? `http://127.0.0.1:${PORT}`

/** 演示库文件：与 data/app.db、data/test.db 隔离 */
export const DEMO_DB_PATH = resolve(DEMO_DIR, '.db', 'demo.db')
/** 免登录状态：片段 2-5 直接带着 cookie 开场，第一帧就是页面而不是登录页 */
export const AUTH_STATE_PATH = resolve(DEMO_DIR, '.auth', 'state.json')

/** 演示题库 PDF（gen-demo-pdf.mjs 生成） */
export const DEMO_PDF_PATH = resolve(DEMO_DIR, 'assets', DEMO_PDF_NAME)
/** 静音 MP3：mock /api/tts 用（真音频文件，<audio> 才肯播） */
export const SILENT_MP3_PATH = resolve(DEMO_DIR, 'assets', 'silent.mp3')
/** 一段真实 webm 音频：片段 5 往 IndexedDB 里播种录音用 */
export const SEED_CLIP_PATH = resolve(DEMO_DIR, 'assets', 'seed-clip.webm')

/** 演示账号：本地一次性库，与线上账号无关 */
export const DEMO_ACCOUNT = 'demo'
export const DEMO_PASSWORD = 'demo1234'

/** 题库规模（与 questions-demo.ts 一致，给首页/背诵页断言用） */
export const QUESTION_COUNT = DEMO_QUESTIONS.length

/**
 * 录制视口：iPhone 12/13/14 逻辑分辨率，本项目移动优先，UI 按 390px 宽设计。
 * 必须与 playwright.config.ts 的 viewport、screencast 的 size 三者一致，
 * 否则画面会被缩放、文字发虚。
 */
export const VIEWPORT = { width: 390, height: 844 }

/** 片段清单，顺序即录制 / 转码顺序。 */
export const CLIPS = [
  { id: '01-login-home', title: '登录与首页' },
  { id: '02-import', title: 'PDF 导入题库' },
  { id: '03-recite', title: '背诵：翻卡 · 自动阅读 · AI 重点' },
  { id: '04-review', title: '复习：开口讲 · 对照答案' },
  { id: '05-clips-bank', title: '我的录音与题库管理' },
] as const
