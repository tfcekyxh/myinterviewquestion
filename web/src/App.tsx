import { Navigate, Route, Routes } from 'react-router-dom'
import { useSession } from './lib/session'
import Login from './pages/Login'
import Home from './pages/Home'
import Import from './pages/Import'

export default function App() {
  const { user, loading, error, setUser, refresh } = useSession()

  if (loading) return <div className="screen-center">加载中…</div>

  if (error) {
    return (
      <div className="screen">
        <div style={{ flex: 1 }} />
        <div className="inline-error" role="alert">
          {error}
        </div>
        <button type="button" className="btn-primary" style={{ marginTop: 16 }} onClick={() => void refresh()}>
          重试
        </button>
        <div style={{ flex: 1 }} />
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login onSuccess={refresh} />} />
      <Route
        path="/import"
        element={user ? <Import /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/"
        element={
          user ? (
            <Home
              user={user}
              onLogout={() => {
                setUser(null)
                void refresh()
              }}
            />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
