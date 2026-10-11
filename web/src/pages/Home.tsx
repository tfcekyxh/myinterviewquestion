import { logout } from '../lib/api'
import type { SessionUser } from '../lib/api'

interface Props {
  user: SessionUser
  onLogout: () => void
}

/**
 * P1 阶段的骨架首页：只验证「登录后能进来」。
 * P2 会把它换成 ued.md 的 S1（已导入）/ S1b（未导入）两种状态。
 */
export default function Home({ user, onLogout }: Props) {
  async function doLogout() {
    await logout().catch(() => undefined)
    onLogout()
  }

  return (
    <div className="screen">
      <div className="t-title-2">首页</div>
      <div className="t-caption color-text-2" style={{ marginTop: 8 }}>
        已登录：{user.account}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="t-body-strong">题库功能待接入</div>
        <div className="t-caption color-text-2" style={{ marginTop: 8 }}>
          P1 只跑通骨架与登录；导入题库、背诵、复习在后续阶段接上。
        </div>
      </div>

      <div style={{ flex: 1 }} />
      <button type="button" className="btn-primary" onClick={doLogout}>
        退出登录
      </button>
    </div>
  )
}
