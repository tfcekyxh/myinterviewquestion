// 登录 / 登出 / 当前登录状态
import { Router } from 'express'
import { login } from '../auth.js'

export const authRouter = Router()

authRouter.post('/login', (req, res) => {
  const { account, password } = req.body ?? {}
  if (typeof account !== 'string' || typeof password !== 'string' || !account || !password) {
    return res.status(400).json({ error: '请填写账号和密码' })
  }
  const user = login(account, password)
  if (!user) {
    return res.status(401).json({ error: '账号或密码不正确' })
  }
  // 换 session id，防会话固定
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: '登录失败，请重试' })
    req.session.userId = user.id
    req.session.account = user.account
    req.session.save((e2) => {
      if (e2) return res.status(500).json({ error: '登录失败，请重试' })
      res.json({ ok: true, account: user.account })
    })
  })
})

authRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid')
    res.json({ ok: true })
  })
})

authRouter.get('/me', (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: '未登录' })
  res.json({ userId: req.session.userId, account: req.session.account })
})

/** 未登录拦截：挂在需要登录的 API 上 */
export function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: '未登录' })
  next()
}
