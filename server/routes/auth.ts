// 登录 / 登出 / 当前登录状态
import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { login } from '../auth.ts'
import { checkLoginGate, recordLoginFailure, recordLoginSuccess } from '../loginLimit.ts'

export const authRouter = Router()

authRouter.post('/login', (req: Request, res: Response) => {
  const { account, password } = req.body ?? {}
  if (typeof account !== 'string' || typeof password !== 'string' || !account || !password) {
    return res.status(400).json({ error: '请填写账号和密码' })
  }
  const acct = account.trim()

  // 防爆破：失败 5 次锁 10 分钟。锁定期间直接拒，不校验密码也不计失败，
  // 所以解锁时刻固定，不会因为一直被戳而无限续期。
  const gate = checkLoginGate(acct)
  if (gate.locked) {
    const minutes = Math.max(1, Math.ceil(gate.retryAfterMs / 60000))
    console.warn(`[登录] 锁定中拒绝：account=${acct}（还需 ${minutes} 分钟）`)
    res.set('Retry-After', String(Math.ceil(gate.retryAfterMs / 1000)))
    return res.status(429).json({ error: `失败次数过多，账号已临时锁定，约 ${minutes} 分钟后重试` })
  }

  const user = login(acct, password)
  if (!user) {
    const n = recordLoginFailure(acct)
    console.warn(`[登录] 失败：account=${acct}（窗口内第 ${n} 次）`)
    return res.status(401).json({ error: '账号或密码不正确' })
  }
  recordLoginSuccess(acct)
  // 换 session id，防会话固定
  req.session.regenerate((err: unknown) => {
    if (err) return res.status(500).json({ error: '登录失败，请重试' })
    req.session.userId = user.id
    req.session.account = user.account
    req.session.save((e2?: unknown) => {
      if (e2) return res.status(500).json({ error: '登录失败，请重试' })
      res.json({ ok: true, account: user.account })
    })
  })
})

authRouter.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.clearCookie('sid')
    res.json({ ok: true })
  })
})

authRouter.get('/me', (req: Request, res: Response) => {
  if (!req.session?.userId) return res.status(401).json({ error: '未登录' })
  res.json({ userId: req.session.userId, account: req.session.account })
})

/** 未登录拦截：挂在需要登录的 API 上 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) return res.status(401).json({ error: '未登录' })
  next()
}
