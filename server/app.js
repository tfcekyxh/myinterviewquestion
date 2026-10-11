// Express 应用装配。
// ⚠️ 三条硬约束，违反会直接导致线上故障：
//   1. 必须 set('trust proxy', 1) —— 否则 HTTPS 下 secure Cookie 不下发，症状是「登录成功但一刷新就掉线」
//   2. 路由顺序必须是 /api → static(dist) → app.get('*') 兜底，颠倒会把 /api 吞掉
//   3. 依赖必须零原生编译
import express from 'express'
import session from 'express-session'
import path from 'node:path'
import fs from 'node:fs'
import { authRouter } from './routes/auth.js'
import { questionsRouter } from './routes/questions.js'
import { progressRouter } from './routes/progress.js'
import { reviewsRouter } from './routes/reviews.js'
import { SqliteStore, pruneSessions } from './sessionStore.js'

const DIST = path.resolve('web/dist')

export function createApp() {
  const app = express()

  // 部署在反向代理后面，缺这行会让 secure Cookie 静默失效
  app.set('trust proxy', 1)

  app.use(express.json({ limit: '20mb' }))

  app.use(
    session({
      name: 'sid',
      secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
      store: new SqliteStore(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto', // 配合 trust proxy：HTTPS 下自动加 Secure，本地 http 下不加
        maxAge: 7 * 864e5,
      },
    }),
  )

  // 1. API
  app.use('/api', authRouter)
  app.use('/api/questions', questionsRouter)
  app.use('/api/progress', progressRouter)
  app.use('/api/reviews', reviewsRouter)
  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  // 2. 静态产物（可能还没构建过，缺失时给明确提示而不是白屏）
  if (fs.existsSync(DIST)) {
    app.use(express.static(DIST))
  } else {
    app.get('/', (_req, res) =>
      res.status(503).type('html').send('<h1>前端尚未构建</h1><p>请先执行 <code>npm run build</code>。</p>'),
    )
  }

  // 3. SPA 兜底：必须放最后。
  //    Express 5 用 path-to-regexp v8，通配符必须写成 /*splat，写 '*' 会直接抛 PathError
  app.get('/*splat', (_req, res) => {
    const file = path.join(DIST, 'index.html')
    if (!fs.existsSync(file)) {
      return res.status(503).type('html').send('<h1>前端尚未构建</h1><p>请先执行 <code>npm run build</code>。</p>')
    }
    res.sendFile(file)
  })

  pruneSessions()
  return app
}
