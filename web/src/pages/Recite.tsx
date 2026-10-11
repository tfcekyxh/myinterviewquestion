import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  fetchFullBank,
  fetchProgress,
  saveProgress,
  type ProgressPatch,
  type ProgressState,
  type Question,
  type ReciteMode,
} from '../lib/api'
import { cursor, doneCount, isFinished, patchForCount, seqsFor, shuffle, withCount } from '../lib/recite'

/**
 * 背诵页（ued.md S4）。
 *
 * 三个刻意的设计：
 *  1. 题答同屏，没有「显示答案」按钮 —— 本期决策（project-scope.md 卡片形式）
 *  2. 顺序 / 随机各存一个位置，来回切都不丢进度
 *  3. 位置语义是「已背题数」，能取到 N（背完），不是数组下标
 */
export default function Recite() {
  const navigate = useNavigate()

  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [prog, setProg] = useState<ProgressState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // 写进度是「后写覆盖先写」，必须串行化：连点下一题时若并发发出，
  // 网络的乱序会让位置回退。用一条 Promise 链把它们排好队。
  const writeChain = useRef<Promise<unknown>>(Promise.resolve())
  const persist = useCallback((patch: ProgressPatch) => {
    writeChain.current = writeChain.current.then(() => saveProgress(patch)).catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [bank, saved] = await Promise.all([fetchFullBank(), fetchProgress()])
        if (cancelled) return
        if (bank.questions.length === 0) {
          setError('还没有题库，先导入一份 PDF')
          return
        }
        let state = saved
        // 随机模式但序列作废（服务端清过）→ 当场重新洗一组，别把空序列渲染出去
        if (state.mode === 'random' && state.randOrder.length !== bank.questions.length) {
          const randOrder = shuffle(bank.questions.map((q) => q.seq))
          state = { ...state, randOrder, posRandom: 0 }
          persist({ mode: 'random', randOrder, posRandom: 0 })
        }
        // 记下这一轮的起点：服务端背完时会用它结算「刚背完的一轮」。
        // 所以从第 129 题接着背，这一轮就是 129–240，而不是永远等于整个题库。
        const done = state.mode === 'order' ? state.posOrder : state.posRandom
        if (state.roundStart === null && done < bank.questions.length) {
          state = { ...state, roundStart: done }
          persist({ roundStart: done })
        }
        setQuestions(bank.questions)
        setProg(state)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [persist])

  // 行内提示 2 秒后自动消失
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  const touch = useRef<{ x: number; y: number } | null>(null)

  const allSeqs = (questions ?? []).map((q) => q.seq)
  const seqs = prog ? seqsFor(prog, allSeqs) : []
  const total = seqs.length
  const index = prog ? cursor(prog, total) : 0
  const done = prog ? doneCount(prog) : 0
  const finished = prog ? isFinished(prog, total) : false
  const current = (questions ?? []).find((q) => q.seq === seqs[index]) ?? null

  function goToCount(count: number) {
    if (!prog) return
    const next = Math.max(0, Math.min(count, total))
    if (next === done) return
    setProg(withCount(prog, next))
    persist(patchForCount(prog.mode, next))
  }

  /** 重新洗一组随机序列，并回到这一组的开头 */
  function reshuffle() {
    if (!prog) return
    const randOrder = shuffle(allSeqs)
    setProg({ ...prog, mode: 'random', randOrder, posRandom: 0 })
    persist({ mode: 'random', randOrder, posRandom: 0 })
    setToast('已切换为随机')
  }

  function switchMode(mode: ReciteMode) {
    if (!prog) return
    // 再点一次「随机」= 换一批（这是拿到新顺序的入口）
    if (mode === prog.mode) {
      if (mode === 'random') reshuffle()
      return
    }
    if (mode === 'order') {
      setProg({ ...prog, mode: 'order' })
      persist({ mode: 'order' })
      setToast('已切换为顺序')
      return
    }
    // 切到随机：reshuffle 里已经把 mode 一起设成 random 了
    reshuffle()
  }

  /** 这一轮重头再背：位置归零，并把这一轮的起点也归零 */
  function restartRound() {
    if (!prog) return
    setProg({ ...withCount(prog, 0), roundStart: 0 })
    persist({ ...patchForCount(prog.mode, 0), roundStart: 0 })
  }

  // 左右滑动 = 上一题 / 下一题（ued.md S4 交互）
  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }

  function onTouchEnd(e: TouchEvent) {
    const start = touch.current
    touch.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    // 横向位移要明显压过纵向，否则会和答案区的上下滚动打架
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return
    goToCount(done + (dx < 0 ? 1 : -1))
  }

  if (loading) return <div className="screen-center">加载中…</div>

  if (error || !prog || !current) {
    return (
      <div className="screen">
        <div style={{ flex: 1 }} />
        <div className="inline-error" role="alert">
          {error ?? '这一题读不出来'}
        </div>
        <button type="button" className="btn-primary" style={{ marginTop: 16 }} onClick={() => navigate('/')}>
          回到首页
        </button>
        <div style={{ flex: 1 }} />
      </div>
    )
  }

  return (
    <div className="screen screen-fill">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="navbar-action" onClick={() => navigate('/')} aria-label="返回">
          ‹
        </button>
        <span className="t-caption color-text-2" style={{ flex: 1 }}>
          第 {index + 1} / {total} 题
        </span>
        <div className="chip-group" role="group" aria-label="背诵模式">
          <button
            type="button"
            className={`chip${prog.mode === 'order' ? ' is-active' : ''}`}
            aria-pressed={prog.mode === 'order'}
            onClick={() => switchMode('order')}
          >
            顺序
          </button>
          <button
            type="button"
            className={`chip${prog.mode === 'random' ? ' is-active' : ''}`}
            aria-pressed={prog.mode === 'random'}
            onClick={() => switchMode('random')}
          >
            随机
          </button>
        </div>
      </div>

      <div className="progress-bar" style={{ marginTop: 12 }}>
        <span style={{ width: `${total ? ((index + 1) / total) * 100 : 0}%` }} />
      </div>

      {toast && (
        <div className="inline-info" role="status" style={{ marginTop: 12 }}>
          {toast}
        </div>
      )}

      <div className="scroll-area" style={{ marginTop: 16 }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="card" data-testid="recite-card">
          <div className="t-title-1">{current.question}</div>
          <hr className="divider" />
          <div className="t-body color-text-2" style={{ whiteSpace: 'pre-wrap' }}>
            {current.answer}
          </div>
        </div>
      </div>

      {finished && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="t-body-strong">这一轮背完了</div>
          <div className="t-caption color-text-2" style={{ marginTop: 4 }}>
            去复习一遍，对着题目开口讲，比再读一遍记得牢
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button type="button" className="btn-secondary" style={{ flex: 1, height: 40 }} onClick={restartRound}>
              再背一遍
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ flex: 1, height: 40 }}
              onClick={() => navigate('/review?scope=round')}
            >
              去复习
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button
          type="button"
          className="btn-secondary"
          style={{ flex: 1 }}
          disabled={done <= 0}
          onClick={() => goToCount(done - 1)}
        >
          上一题
        </button>
        <button
          type="button"
          className="btn-primary"
          style={{ flex: 1 }}
          disabled={finished}
          onClick={() => goToCount(done + 1)}
        >
          {index + 1 === total ? '背完了' : '下一题'}
        </button>
      </div>

      <div className="t-micro color-text-3" style={{ textAlign: 'center', marginTop: 8 }}>
        答案与题目同屏，先自己过一遍再看
      </div>
    </div>
  )
}
