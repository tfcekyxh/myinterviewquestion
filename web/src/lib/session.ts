import { useEffect, useState } from 'react'
import { fetchMe, type SessionUser } from './api'

/**
 * 会话状态。刷新页面时用它去后端问一次 —— 因为 session 存在服务端 SQLite 里，
 * 只要 Cookie 还在，刷新就不会掉线。
 */
export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      setUser(await fetchMe())
      setError(null)
    } catch {
      setError('连不上服务器，请检查网络后重试')
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  return { user, loading, error, setUser, refresh }
}
