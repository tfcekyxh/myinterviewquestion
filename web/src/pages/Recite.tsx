import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import ErrorScreen from '../components/ErrorScreen'
import KeyPointsPanel, { type KeyPointError } from '../components/KeyPointsPanel'
import {
  fetchFullBank,
  fetchProgress,
  saveProgress,
  fetchKeyPoints,
  saveKeyPoints,
  regenerateKeyPoints,
  type ProgressPatch,
  type ProgressState,
  type Question,
  type ReciteMode,
  type KeyPoints,
  type ApiError,
} from '../lib/api'
import { cursor, doneCount, isFinished, patchForCount, seqsFor, shuffle, withCount } from '../lib/recite'
import {
  createSpeaker,
  isSpeechSupported,
  primeVoices,
  segmentsForCard,
  type Speaker,
} from '../lib/speech'
import {
  ANSWER_WAIT_MS,
  createAudioPlayer,
  isWarm,
  resetServerAudio,
  segmentUrl,
  warmSegment,
  withTimeout,
} from '../lib/cardAudio'

/**
 * 背诵页（ued.md S4）。
 *
 * 三个刻意的设计：
 *  1. 题答同屏，没有「显示答案」按钮 —— 本期决策（project-scope.md 卡片形式）
 *  2. 顺序 / 随机各存一个位置，来回切都不丢进度
 *  3. 位置语义是「已背题数」，能取到 N（背完），不是数组下标
 */

const AUTO_READ_KEY = 'recite.autoRead'
const AUTO_NEXT_KEY = 'recite.autoNext'
// 回答重点生成防抖：快速翻卡时不打接口，停在某一题才生成。
// 否则每张卡都立刻调一次 LLM，免费档会被突发请求限流（502）。
const KP_DEBOUNCE_MS = 600

function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false // Safari 无痕模式下 localStorage 会抛
  }
}

function storeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // 存不了不影响本次使用
  }
}
export default function Recite() {
  const navigate = useNavigate()

  const [questions, setQuestions] = useState<Question[] | null>(null)
  const [prog, setProg] = useState<ProgressState | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // 不支持朗读的浏览器（含测试环境的 jsdom）直接不显示这个开关
  const [speechOn] = useState(() => isSpeechSupported())
  // 音色列表是异步就绪的，进页面就开始预热，免得第一次念的时候还挑不出中文音色
  useEffect(() => {
    if (speechOn) primeVoices()
    // 每次进背诵页都重新试一次服务端音频：上次不通不代表这次也不通
    resetServerAudio()
  }, [speechOn])
  const [autoRead, setAutoRead] = useState(() => loadFlag(AUTO_READ_KEY))
  // 念完一整张卡就自动翻下一题（连着听，不用一直点）
  const [autoNext, setAutoNext] = useState(() => loadFlag(AUTO_NEXT_KEY))
  // iOS 每次刷新都要重新「解锁」一次：记住的开关不能靠 useEffect 自动开播，
  // 那条路径不在用户手势栈里，会静默失败。只有本次会话里用户真碰过一次屏幕，
  // 才认这个开关是活的。
  const [speechArmed, setSpeechArmed] = useState(false)
  // 这一题实际用的是哪个音源 —— 显示出来，不然「听着还是机械的」无从判断问题出在哪
  const [audioSource, setAudioSource] = useState<'server' | 'local' | null>(null)

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
  const currentSeq = current?.seq ?? null

  // ── 每题的「回答重点」：按题号懒加载 + 缓存（首题自动生成，之后翻回来直接读库）──
  const [kp, setKp] = useState<Record<number, { data?: KeyPoints; loading?: boolean; error?: KeyPointError }>>({})
  const [regen, setRegen] = useState<Record<number, boolean>>({})
  const requested = useRef<Set<number>>(new Set())
  const latestSeq = useRef<number | null>(null)
  const kpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const kpAbortRef = useRef<AbortController | null>(null)

  const loadKeyPoints = useCallback(async (seq: number, signal?: AbortSignal) => {
    setKp((m) => ({ ...m, [seq]: { ...m[seq], loading: true, error: undefined } }))
    try {
      const dto = await fetchKeyPoints(seq, signal)
      if (latestSeq.current !== seq) return
      setKp((m) => ({ ...m, [seq]: { data: dto, loading: false } }))
    } catch (e) {
      if (latestSeq.current !== seq) return
      // 切走时主动 abort 的取消不算失败
      if ((e as Error)?.name === 'AbortError') return
      const ae = e as ApiError
      const err: KeyPointError =
        ae?.status === 503 && ae?.message === 'AI_NOT_CONFIGURED' ? 'not-configured' : 'failed'
      setKp((m) => ({ ...m, [seq]: { loading: false, error: err } }))
    }
  }, [])

  useEffect(() => {
    if (currentSeq === null) return
    latestSeq.current = currentSeq
    // 同一题只自动生成一次；切回来若已缓存就直接读（kp 里已有）
    if (requested.current.has(currentSeq)) return
    // 防抖：快速翻卡时不打接口，停在某一题才生成，避免对免费模型突发请求被限流 502
    kpTimerRef.current = setTimeout(() => {
      requested.current.add(currentSeq)
      kpAbortRef.current?.abort()
      const ctrl = new AbortController()
      kpAbortRef.current = ctrl
      void loadKeyPoints(currentSeq, ctrl.signal)
    }, KP_DEBOUNCE_MS)
    return () => {
      if (kpTimerRef.current) clearTimeout(kpTimerRef.current)
    }
  }, [currentSeq, loadKeyPoints])

  const handleSaveKeyPoints = useCallback(async (seq: number, points: string[]) => {
    try {
      const dto = await saveKeyPoints(seq, points)
      setKp((m) => ({ ...m, [seq]: { data: dto, loading: false } }))
      setToast('已保存你的重点')
    } catch {
      setToast('保存失败，请重试')
    }
  }, [])

  const handleRegenerate = useCallback(async (seq: number) => {
    setRegen((m) => ({ ...m, [seq]: true }))
    try {
      const dto = await regenerateKeyPoints(seq)
      if (latestSeq.current === seq) setKp((m) => ({ ...m, [seq]: { data: dto, loading: false } }))
    } catch (e) {
      const ae = e as ApiError
      // 原本就没有重点（首题生成失败）→ 标成失败态给重试入口；已有旧内容 → 只提示，不覆盖
      if (!kp[seq]?.data) {
        const err: KeyPointError =
          ae?.status === 503 && ae?.message === 'AI_NOT_CONFIGURED' ? 'not-configured' : 'failed'
        setKp((m) => ({ ...m, [seq]: { loading: false, error: err } }))
      } else {
        setToast('重新生成失败，仍显示上次内容')
      }
    } finally {
      setRegen((m) => ({ ...m, [seq]: false }))
    }
  }, [kp])

  // 全局只有一个 speechSynthesis，整页共用一个播放器实例（多个实例会互相 cancel）
  const speakerRef = useRef<Speaker | null>(null)
  const getSpeaker = useCallback(() => {
    if (!speakerRef.current) speakerRef.current = createSpeaker()
    return speakerRef.current
  }, [])
  const spokenSeq = useRef<number | null>(null)
  /** 这一题是不是正在念（连播开关要靠它判断该等，还是该立刻翻页） */
  const speakingRef = useRef(false)
  // 连播的「翻下一题」动作必须读最新值：onDone 回调是在开播那一刻就捕获的，
  // 用户可能播到一半才打开连播 —— 直接读 state 会拿到旧的 false。
  const autoNextRef = useRef(autoNext)
  const goNextRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    autoNextRef.current = autoNext
    goNextRef.current = () => {
      if (!finished) goToCount(done + 1)
    }
  })

  // ── 服务端音频：音质比 iOS 内置的好，而且是真音频，锁屏也能接着听 ──
  const audioRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null)
  const getAudioPlayer = useCallback(() => {
    if (!audioRef.current) audioRef.current = createAudioPlayer()
    return audioRef.current
  }, [])
  const stopAll = useCallback(() => {
    speakingRef.current = false
    getSpeaker().stop()
    getAudioPlayer().stop()
  }, [getSpeaker, getAudioPlayer])

  /** 念当前这张卡：题目 → 停顿 → 答案。同一题只念一次。 */
  const playCard = useCallback(() => {
    if (!current || spokenSeq.current === current.seq) return
    const seq = current.seq
    spokenSeq.current = seq
    speakingRef.current = true
    // 两个引擎互斥：不管走哪条，都先把另一条停掉
    getSpeaker().stop()
    getAudioPlayer().stop()

    // 整张卡念完（题目+答案都念完）才翻页，不能题目一念完就跳走
    const onCardDone = () => {
      speakingRef.current = false
      if (autoNextRef.current) goNextRef.current()
    }

    if (isWarm(seq, 'q')) {
      // 题目音频已经预取好 —— 立刻播它（此刻还在用户手势的同步栈里，iOS 才允许出声）
      setAudioSource('server')
      getAudioPlayer().play(segmentUrl(seq, 'q'), {
        title: current.question,
        getAnswerUrl: async () => {
          if (!isWarm(seq, 'a')) await withTimeout(warmSegment(seq, 'a'), ANSWER_WAIT_MS)
          return segmentUrl(seq, 'a')
        },
        onAnswerUnavailable: () => {
          // 答案音频终究没来：用本机朗读把答案念完，不能整段没了
          setAudioSource('local')
          getSpeaker().play(segmentsForCard('', current.answer), { onDone: onCardDone })
        },
        onDone: onCardDone,
      })
      return
    }

    // 题目音频还没到（或服务端生不出来）→ iOS 内置朗读顶上，至少不会没声音。
    // 同时解锁 audio 元素：这样答案音频稍后到了也能接上去播。
    setAudioSource('local')
    getAudioPlayer().unlock()
    getSpeaker().play(segmentsForCard(current.question, current.answer), { onDone: onCardDone })
  }, [current, getSpeaker, getAudioPlayer])

  // 进题目就把音频拉好：等用户点了再下载就来不及了 ——
  // iOS 要求第一次出声必须在点击的同步调用栈里，异步下载完再 play 会静默失败。
  // 题目一定要先拉：它决定这一题能不能用上服务端音质；答案（约 7 秒）可以慢慢来。
  useEffect(() => {
    if (currentSeq === null) return
    const next = seqs[index + 1]
    const wanted: Array<[number, 'q' | 'a']> = [
      [currentSeq, 'q'],
      [currentSeq, 'a'],
    ]
    if (typeof next === 'number') wanted.push([next, 'q'])

    let cancelled = false
    ;(async () => {
      await Promise.all(
        wanted.map(([s, part]) =>
          isWarm(s, part) ? undefined : warmSegment(s, part).catch(() => undefined),
        ),
      )
      if (cancelled) return
      // 音频到位了但这一题还没出声（用户还没点开关）→ 不用做什么，点了就会用上
    })()
    return () => {
      cancelled = true
    }
  }, [currentSeq, index, seqs])

  useEffect(() => {
    if (!autoRead || !speechArmed || currentSeq === null) {
      stopAll()
      return
    }
    playCard()
  }, [autoRead, speechArmed, currentSeq, playCard, stopAll])

  // 开关是记住的、但这一轮还没解锁时，等用户第一次碰屏幕再开播。
  // 必须在 pointerdown 里同步念出第一句 —— 这一次就是 iOS 要的解锁手势。
  useEffect(() => {
    if (!speechOn || !autoRead || speechArmed) return
    const arm = () => {
      setSpeechArmed(true)
      playCard()
    }
    window.addEventListener('pointerdown', arm, { once: true, capture: true })
    return () => window.removeEventListener('pointerdown', arm, { capture: true })
  }, [speechOn, autoRead, speechArmed, playCard])

  // 离开页面必须停，否则声音会跟着你念到别的页面去
  useEffect(() => () => stopAll(), [stopAll])

  function toggleAutoRead() {
    const next = !autoRead
    setAutoRead(next)
    storeFlag(AUTO_READ_KEY, next)
    if (!next) {
      stopAll()
      spokenSeq.current = null
      setAudioSource(null)
      return
    }
    // iOS 只认真实点击那一次的同步调用栈：开开关时必须在这里立刻念，
    // 交给 useEffect 就脱离手势了，会静默失败。
    setSpeechArmed(true)
    playCard()
  }

  function toggleAutoNext() {
    const next = !autoNext
    setAutoNext(next)
    storeFlag(AUTO_NEXT_KEY, next)
    if (!next) return
    // 开了连播，而当前这张已经念完了（用户是听完才开的）→ 直接翻下去，
    // 不然要等一个永远不会来的「念完」事件。正在念的话就不打断，交给 onDone。
    if (autoRead && speechArmed && !speakingRef.current && !finished) goToCount(done + 1)
  }

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
      <ErrorScreen
        message={error ?? '这一题读不出来'}
        action={{ label: '回到首页', onClick: () => navigate('/') }}
      />
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

      {speechOn && (
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}
        >
          <span className="t-micro color-text-3">
            {!autoRead ? '' : audioSource === 'server' ? '云端音质' : '本机朗读'}
          </span>
          <div className="chip-group" role="group" aria-label="朗读设置">
            <button
              type="button"
              role="switch"
              aria-checked={autoRead}
              className={`chip${autoRead ? ' is-active' : ''}`}
              onClick={toggleAutoRead}
            >
              {autoRead ? '✓ 自动阅读' : '自动阅读'}
            </button>
            {autoRead && (
              <button
                type="button"
                role="switch"
                aria-checked={autoNext}
                className={`chip${autoNext ? ' is-active' : ''}`}
                onClick={toggleAutoNext}
              >
                {autoNext ? '✓ 连播' : '连播'}
              </button>
            )}
          </div>
        </div>
      )}

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

        <KeyPointsPanel
          key={currentSeq ?? -1}
          seq={currentSeq ?? 0}
          data={currentSeq != null ? (kp[currentSeq]?.data ?? null) : null}
          loading={currentSeq != null ? (kp[currentSeq]?.loading ?? false) : false}
          error={currentSeq != null ? (kp[currentSeq]?.error ?? null) : null}
          regenerating={currentSeq != null ? (regen[currentSeq] ?? false) : false}
          onSave={(pts) => currentSeq != null && handleSaveKeyPoints(currentSeq, pts)}
          onRegenerate={() => currentSeq != null && handleRegenerate(currentSeq)}
          onRetry={() => currentSeq != null && loadKeyPoints(currentSeq)}
        />
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
