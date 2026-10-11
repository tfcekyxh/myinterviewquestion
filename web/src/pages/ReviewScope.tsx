import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchBank, fetchProgress, type ProgressState, type ReciteMode, type ReviewRound } from '../lib/api'
import { seqRangeLabel } from '../lib/recite'

/**
 * 复习范围选择（ued.md S5）。
 * 两张卡：刚背完的这一轮 / 整个题库；默认选中前者（没有背完记录时禁用）。
 * 模式默认沿用背诵时的模式。
 */
export default function ReviewScope() {
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [total, setTotal] = useState(0)
  const [prog, setProg] = useState<ProgressState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [mode, setMode] = useState<ReciteMode>('order')
  const [scope, setScope] = useState<'round' | 'all'>('round')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [bank, p] = await Promise.all([fetchBank(), fetchProgress()])
        if (cancelled) return
        setTotal(bank.total)
        setProg(p)
        setMode(p.mode)
        // 默认沿用背诵时的模式；范围默认「刚背完的这一轮」，没有记录才退到「整个题库」
        const want = params.get('scope')
        const hasRound = (p.lastRound?.seqs.length ?? 0) > 0
        setScope(want === 'all' || !hasRound ? 'all' : 'round')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // 只在首次进入时决定默认值，之后交给用户
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) return <div className="screen-center">加载中…</div>

  const round: ReviewRound | null = prog?.lastRound ?? null
  const roundSeqs = round?.seqs ?? []
  const hasRound = roundSeqs.length > 0 && total > 0
  const ready = total > 0 && (scope === 'all' || hasRound)

  function choose(next: 'round' | 'all') {
    setTouched(true)
    setScope(next)
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button type="button" className="navbar-action" onClick={() => navigate('/')} aria-label="返回">
          ‹
        </button>
        <span className="navbar-title">开始复习</span>
        <span style={{ minWidth: 44 }} />
      </div>

      {error && (
        <div className="inline-error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      <div className="t-caption color-text-2" style={{ marginTop: 16 }}>
        答案会先藏起来，请对着题目开口讲一遍并录音
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        <button
          type="button"
          className={`scope-card${scope === 'round' ? ' is-active' : ''}`}
          aria-pressed={scope === 'round'}
          disabled={!hasRound}
          onClick={() => choose('round')}
        >
          <span className="t-body-strong">刚背完的这一轮</span>
          <span className="t-caption color-text-3">
            {hasRound ? seqRangeLabel(roundSeqs) : '还没有背完的记录'}
          </span>
        </button>

        <button
          type="button"
          className={`scope-card${scope === 'all' ? ' is-active' : ''}`}
          aria-pressed={scope === 'all'}
          disabled={total === 0}
          onClick={() => choose('all')}
        >
          <span className="t-body-strong">整个题库</span>
          <span className="t-caption color-text-3">
            {total > 0 ? `共 ${total} 题` : '还没有导入题库'}
          </span>
        </button>
      </div>

      <div style={{ marginTop: 20 }}>
        <div className="t-caption color-text-2" style={{ marginBottom: 8 }}>
          复习顺序
        </div>
        <div className="chip-group" role="group" aria-label="复习顺序">
          <button
            type="button"
            className={`chip${mode === 'order' ? ' is-active' : ''}`}
            aria-pressed={mode === 'order'}
            onClick={() => setMode('order')}
          >
            顺序
          </button>
          <button
            type="button"
            className={`chip${mode === 'random' ? ' is-active' : ''}`}
            aria-pressed={mode === 'random'}
            onClick={() => setMode('random')}
          >
            随机
          </button>
        </div>
      </div>

      {touched && scope === 'round' && !hasRound && (
        <div className="inline-error" role="alert" style={{ marginTop: 16 }}>
          还没有背完的一轮，先选「整个题库」吧
        </div>
      )}

      <div style={{ flex: 1 }} />

      <button
        type="button"
        className="btn-primary"
        disabled={!ready}
        onClick={() => navigate(`/review/run?scope=${scope}&mode=${mode}`)}
      >
        开始复习
      </button>

      <div className="t-micro color-text-3" style={{ textAlign: 'center', marginTop: 12 }}>
        录音只保存在这台设备上，不会上传
      </div>
    </div>
  )
}
