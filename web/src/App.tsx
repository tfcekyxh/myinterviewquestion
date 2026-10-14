import { Navigate, Route, Routes } from 'react-router-dom'
import ErrorScreen from './components/ErrorScreen'
import { useSession } from './lib/session'
import Login from './pages/Login'
import Home from './pages/Home'
import Import from './pages/Import'
import Bank from './pages/Bank'
import Clips from './pages/Clips'
import Recite from './pages/Recite'
import ReviewScope from './pages/ReviewScope'
import Review from './pages/Review'

export default function App() {
  const { user, loading, error, setUser, refresh } = useSession()

  if (loading) return <div className="screen-center">加载中…</div>

  // 连不上服务器时不能白屏（P5）：整页给一条看得见的错误 + 「重试」
  if (error) {
    return <ErrorScreen message={error} action={{ label: '重试', onClick: () => void refresh() }} />
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login onSuccess={refresh} />} />
      <Route path="/import" element={user ? <Import /> : <Navigate to="/login" replace />} />
      <Route path="/bank" element={user ? <Bank /> : <Navigate to="/login" replace />} />
      <Route path="/clips" element={user ? <Clips /> : <Navigate to="/login" replace />} />
      <Route path="/recite" element={user ? <Recite /> : <Navigate to="/login" replace />} />
      <Route path="/review" element={user ? <ReviewScope /> : <Navigate to="/login" replace />} />
      <Route path="/review/run" element={user ? <Review /> : <Navigate to="/login" replace />} />
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
