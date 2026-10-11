import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchBank, logout, type BankInfo } from '../lib/api'
import type { SessionUser } from '../lib/api'

interface Props {
  user: SessionUser
  onLogout: () => void
}

/**
 * 首页（ued.md S1 / S1b）。
 * 已导入：进度卡 + 题库信息行；未导入：空状态 + 「导入题库」。
 * 进度本身在 P3 接入，这里先把「有没有题库」这件事做对。
 */
export default function Home({ user, onLogout }: Props) {
  const navigate = useNavigate()
  const [bank, setBank] = useState<BankInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setBank(await fetchBank())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载题库信息失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function doLogout() {
    await logout().catch(() => undefined)
    onLogout()
  }

  if (loading) return <div className="screen-center">加载中…</div>

  if (error) {
    return (
      <div className="screen">
        <div style={{ flex: 1 }} />
        <div className="inline-error" role="alert">
          {error}
        </div>
        <button type="button" className="btn-primary" style={{ marginTop: 16 }} onClick={() => void load()}>
          重试
        </button>
        <div style={{ flex: 1 }} />
      </div>
    )
  }

  const imported = (bank?.total ?? 0) > 0

  return (
    <div className="screen">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div className="t-title-2" style={{ flex: 1 }}>
          下午好
        </div>
        <span className="t-caption color-text-3">{user.account}</span>
      </div>

      {imported ? (
        <>
          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ fontSize: 24, lineHeight: '32px', fontWeight: 600 }}>共 {bank?.total} 题</div>
            <div className="t-caption color-text-2" style={{ marginTop: 8 }}>
              背诵与复习将在后续阶段接入
            </div>
          </div>

          <div style={{ flex: 1 }} />
          <button type="button" className="btn-primary" disabled>
            继续背诵
          </button>
          <button type="button" className="btn-secondary" style={{ marginTop: 12 }} disabled>
            开始复习
          </button>
          <div
            className="t-caption color-text-3"
            style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between' }}
          >
            <span className="truncate">
              题库：{bank?.source || '未知来源'} · {bank?.total} 题
            </span>
            <button
              type="button"
              className="navbar-action"
              style={{ minWidth: 0, height: 20, color: 'var(--primary)' }}
              onClick={() => navigate('/bank')}
            >
              管理
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginTop: 20 }}>
            <button
              type="button"
              className="placeholder"
              style={{ width: '100%', border: '1px dashed var(--line)', fontFamily: 'inherit' }}
              onClick={() => navigate('/import')}
            >
              <span style={{ fontSize: 28 }}>＋</span>
              <span className="t-body-strong">还没有题库，点这里导入 PDF</span>
              <span className="t-caption color-text-3">导入后就能一道一道地背了</span>
            </button>
          </div>

          <div style={{ flex: 1 }} />
          <button type="button" className="btn-primary" onClick={() => navigate('/import')}>
            导入题库
          </button>
        </>
      )}

      <button type="button" className="btn-secondary danger" style={{ marginTop: 24 }} onClick={doLogout}>
        退出登录
      </button>
    </div>
  )
}
