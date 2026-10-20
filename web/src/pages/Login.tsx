import { useState, type FormEvent } from 'react'
import { login as loginApi } from '../lib/api'

interface Props {
  onSuccess: () => void
}

export default function Login({ onSuccess }: Props) {
  // 单账号应用：账号默认填 admin，省得每次登录都打一遍
  const [account, setAccount] = useState('admin')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    if (!account.trim() || !password) {
      setError('请填写账号和密码')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await loginApi(account.trim(), password)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请重试')
      setSubmitting(false)
    }
  }

  return (
    <form className="screen" onSubmit={submit} noValidate>
      <div style={{ flex: 1 }} />

      <div className="t-display">面试题背诵</div>
      <div className="t-caption color-text-2" style={{ marginTop: 8, marginBottom: 32 }}>
        把题库变成一张张卡片
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* 用 htmlFor 显式关联，不能把整个 field 包进 <label>：
            那样「显示密码」按钮的文字会一起算进输入框的可访问名，变成「密码 显示密码」 */}
        <div className="field">
          <label className="field-label" htmlFor="account">
            账号
          </label>
          <div className={`field-box${error ? ' is-error' : ''}`}>
            <input
              id="account"
              name="account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="请输入账号"
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="password">
            密码
          </label>
          <div className={`field-box${error ? ' is-error' : ''}`}>
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="请输入密码"
            />
            <button
              type="button"
              className="field-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
            >
              {showPassword ? '隐藏' : '显示'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="inline-error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary" style={{ marginTop: 24 }} disabled={submitting}>
        {submitting ? '登录中…' : '登录'}
      </button>

      <div style={{ flex: 1 }} />
      <div className="t-micro color-text-3" style={{ textAlign: 'center' }}>
        仅本人使用，不开放注册
      </div>
    </form>
  )
}
