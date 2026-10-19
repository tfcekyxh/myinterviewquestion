import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ErrorScreen from '../components/ErrorScreen'
import KeyPointsPanel, { type KeyPointError } from '../components/KeyPointsPanel'
import {
  fetchFullBank,
  fetchProgress,
  saveReview,
  fetchKeyPoints,
  saveKeyPoints,
  regenerateKeyPoints,
  type Question,
  type ReciteMode,
  type KeyPoints,
  type ApiError,
} from '../lib/api'
import { reviewSeqs, type ReviewScope } from '../lib/recite'
import {
  createRecorder,
  formatClock,
  isRecorderSupported,
  type Recording,
  type Recorder,
} from '../lib/recorder'
import { saveClip } from '../lib/audioStore'
import { ShareCancelled, clipFile, saveFile } from '../lib/clipExport'

const BARS = 24
/** 按住不足这么久就当成「点一下开始录」，而不是「说完松手」 */
const HOLD_MS = 400
/** ued：超过 3 分钟给一次提示，但不强制停止 */
const LONG_MS = 3 * 60 * 1000
// 回答重点生成防抖：进入对照后停一下才生成，避免快速翻题对免费模型突发请求被限流
const KP_DEBOUNCE_MS = 600

type Stage = 'ready' | 'recording' | 'compare'

/**
 * 复习页（ued.md S6 待录 → S7 录音中 → S8 对照答案）。
 *
 * ⚠️ 本页最核心的约束：**进入 S8 之前，页面上不得存在任何能看到答案的入口**。
 * 所以答案只在 `stage === 'compare'` 时渲染 —— 不是「藏起来」，是根本不进 DOM。
 * 组件测试里有一条专门断言「整个 body 都不含答案文本」。
 *
 * 录音逻辑全在 lib/recorder.ts 的接口后面。jsdom 里没有 MediaRecorder，
 * 组件测试靠 vi.mock 换桩，真录音只在 e2e / 真机上跑。
 */
export default function Review() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [questions, setQuestions] = useState<Question[]>([])
  const [order, setOrder] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [stage, setStage] = useState<Stage>('ready')
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const [clip, setClip] = useState<Recording | null>(null)

  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [dur, setDur] = useState(0)
  // 「保存这段」的结果。跟 error 分开：这是操作反馈，不是页面级失败
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState<string | null>(null)

  const recorderRef = useRef<Recorder | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const startedAtRef = useRef(0)
  const pressedAtRef = useRef(0)

  const supported = isRecorderSupported()

  // ── 数据 ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [bank, prog] = await Promise.all([fetchFullBank(), fetchProgress()])
        if (cancelled) return
        if (bank.questions.length === 0) {
          setError('还没有题库，先导入一份 PDF')
          return
        }
        const scope: ReviewScope = params.get('scope') === 'round' ? 'round' : 'all'
        const mode: ReciteMode = params.get('mode') === 'random' ? 'random' : 'order'
        const all = bank.questions.map((q) => q.seq)
        const seqs = reviewSeqs(scope, mode, all, prog.lastRound?.seqs ?? [])
        if (seqs.length === 0) {
          setError('这个范围里没有题目')
          return
        }
        setQuestions(bank.questions)
        // 洗牌只在这里做一次并存进 state —— 每次 render 都洗的话顺序会一直变
        setOrder(seqs)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // 只按 URL 上的范围/模式初始化一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── 录音器（懒创建：没按过麦克风就不碰 MediaRecorder）─────────────
  const getRecorder = useCallback(() => {
    if (!recorderRef.current) {
      const r = createRecorder()
      r.setLevelHandler((lv) => {
        setLevels((prev) => (prev.length >= BARS ? [...prev.slice(1), lv] : [...prev, lv]))
      })
      recorderRef.current = r
    }
    return recorderRef.current
  }, [])

  useEffect(
    () => () => {
      // 离开页面时必须把麦克风轨道关掉，否则 iPhone 顶部一直显示「正在录音」
      recorderRef.current?.dispose()
      recorderRef.current = null
    },
    [],
  )

  // 录音计时
  useEffect(() => {
    if (stage !== 'recording') return
    const t = setInterval(() => setElapsed(Date.now() - startedAtRef.current), 200)
    return () => clearInterval(t)
  }, [stage])

  // 换题 / 离开时把回放停掉（ued：离开本屏时音频自动停止）
  const index = Math.max(0, Math.min(Number(params.get('i') ?? 0) || 0, Math.max(0, order.length - 1)))
  const seq = order[index]
  const current = questions.find((q) => q.seq === seq) ?? null

  // 行内提示 2 秒后自动消失（保存重点的反馈）
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2000)
    return () => clearTimeout(t)
  }, [toast])

  // ── 每题的「回答重点」：进入对照阶段后按题号懒加载 + 缓存 ──
  // ⚠️ 必须等 stage === 'compare' 才加载/渲染：重点是从答案提炼的，
  //    对照前出现等于提前泄底，违背本页「答案进 compare 才进 DOM」的红线。
  const [kp, setKp] = useState<Record<number, { data?: KeyPoints; loading?: boolean; error?: KeyPointError }>>({})
  const [regen, setRegen] = useState<Record<number, boolean>>({})
  const requested = useRef<Set<number>>(new Set())
  const latestSeq = useRef<number | null>(null)
  const kpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const kpAbortRef = useRef<AbortController | null>(null)

  const loadKeyPoints = useCallback(async (s: number, signal?: AbortSignal) => {
    setKp((m) => ({ ...m, [s]: { ...m[s], loading: true, error: undefined } }))
    try {
      const dto = await fetchKeyPoints(s, signal)
      if (latestSeq.current !== s) return
      setKp((m) => ({ ...m, [s]: { data: dto, loading: false } }))
    } catch (e) {
      if (latestSeq.current !== s) return
      if ((e as Error)?.name === 'AbortError') return
      const ae = e as ApiError
      const err: KeyPointError =
        ae?.status === 503 && ae?.message === 'AI_NOT_CONFIGURED' ? 'not-configured' : 'failed'
      setKp((m) => ({ ...m, [s]: { loading: false, error: err } }))
    }
  }, [])

  useEffect(() => {
    if (seq == null || stage !== 'compare') return
    latestSeq.current = seq
    // 同一题只自动生成一次；翻回来若已缓存就直接读（kp 里已有）
    if (requested.current.has(seq)) return
    // 防抖：进入对照后停一下才生成，避免快速翻题对免费模型突发请求被限流 502
    kpTimerRef.current = setTimeout(() => {
      requested.current.add(seq)
      kpAbortRef.current?.abort()
      const ctrl = new AbortController()
      kpAbortRef.current = ctrl
      void loadKeyPoints(seq, ctrl.signal)
    }, KP_DEBOUNCE_MS)
    return () => {
      if (kpTimerRef.current) clearTimeout(kpTimerRef.current)
    }
  }, [seq, stage, loadKeyPoints])

  const handleSaveKeyPoints = useCallback(async (s: number, points: string[]) => {
    try {
      const dto = await saveKeyPoints(s, points)
      setKp((m) => ({ ...m, [s]: { data: dto, loading: false } }))
      setToast('已保存你的重点')
    } catch {
      setToast('保存失败，请重试')
    }
  }, [])

  const handleRegenerate = useCallback(async (s: number) => {
    setRegen((m) => ({ ...m, [s]: true }))
    try {
      const dto = await regenerateKeyPoints(s)
      if (latestSeq.current === s) setKp((m) => ({ ...m, [s]: { data: dto, loading: false } }))
    } catch (e) {
      const ae = e as ApiError
      if (!kp[s]?.data) {
        const err: KeyPointError =
          ae?.status === 503 && ae?.message === 'AI_NOT_CONFIGURED' ? 'not-configured' : 'failed'
        setKp((m) => ({ ...m, [s]: { loading: false, error: err } }))
      } else {
        setToast('重新生成失败，仍显示上次内容')
      }
    } finally {
      setRegen((m) => ({ ...m, [s]: false }))
    }
  }, [kp])

  useEffect(() => {
    const a = audioRef.current
    if (a) {
      a.pause()
      a.currentTime = 0
    }
    setPlaying(false)
    setPos(0)
  }, [index, stage])

  // 录音 blob → 可播放的 URL。
  // ⚠️ 必须在这里（事件处理里）一次算好，**不能**放到 useEffect 里：
  // 放 effect 里的话，stage 切到 compare 的那一刻 audioUrl 还是 null，
  // 回放条会先以「禁用」状态出现一帧再变可用 —— 用户（和测试）那一帧点下去就是空的。
  const urlRef = useRef<string | null>(null)

  const attachClip = useCallback((rec: Recording) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    let url: string | null = null
    try {
      url = URL.createObjectURL(rec.blob)
    } catch {
      // 极老的环境没有 createObjectURL：降级成「录音已保存但不能回放」，
      // 绝不能因为放不了音就把「对照答案」也挡住
      url = null
    }
    urlRef.current = url
    setAudioUrl(url)
    setClip(rec)
    setDur(rec.durationMs / 1000)
    setPos(0)
    setPlaying(false)
  }, [])

  const clearClip = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setAudioUrl(null)
    setClip(null)
    setDur(0)
    setPos(0)
    setPlaying(false)
  }, [])

  // 只在卸载时释放。放在 deps 里会因为 StrictMode 的双调用把 URL 提前撤销掉。
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  /**
   * 把这段录音交给系统保存（调到「文件」App / iCloud，绝大多数人选这里）。
   *
   * 和「音频不上云」那条约束不冲突：数据流向是**用户自己的设备**，
   * 我们的服务端不收一个字节。真正想反复回听的去首页「我的录音」。
   */
  async function saveThisClip() {
    if (!clip) return
    setSaving(true)
    setSaveNote(null)
    try {
      const outcome = await saveFile(clipFile(seq, clip, Date.now()))
      setSaveNote(outcome === 'shared' ? '已交给系统，去「文件」App 里找它' : '已下载到本机')
    } catch (e) {
      // 用户在系统面板里点取消不算失败
      if (!(e instanceof ShareCancelled)) setSaveNote('保存失败，可以去「我的录音」里再试')
    } finally {
      setSaving(false)
    }
  }

  async function startRecording() {
    if (stage !== 'ready') return
    setError(null)
    setLevels([])
    setElapsed(0)
    try {
      await getRecorder().start()
      startedAtRef.current = Date.now()
      setStage('recording')
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法开始录音')
    }
  }

  async function finishRecording() {
    if (stage !== 'recording') return
    setStage('ready')
    try {
      const rec = await getRecorder().stop()
      if (!rec) {
        setError('没录到声音，再试一次')
        setLevels([])
        return
      }
      // clip / audioUrl / 时长一次性写好，和 stage 同一批更新 —— 回放条一出现就是可用的
      attachClip(rec)
      setStage('compare')
      // 存档与上报都不挡「对照答案」：存本机失败也照样能听、能看答案
      const key = `clip:${seq}:${Date.now()}`
      void saveClip(key, rec).then((saved) => {
        void saveReview({ seq, durationMs: rec.durationMs, clipKey: saved }).catch(() => undefined)
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '录音结束失败')
    }
  }

  function onMicDown() {
    // ⚠️ 这里**不能**调 preventDefault。实测：在 pointerdown 上取消默认行为会把
    // 后续的兼容鼠标事件一起吃掉，pointerup 就再也不来了 —— 症状是「按住录音后松手不结束」。
    // iOS 的长按选中/浮出菜单交给 CSS 处理（.btn-mic 上的 user-select / touch-callout）。
    pressedAtRef.current = Date.now()
    if (stage === 'recording') {
      void finishRecording()
      return
    }
    void startRecording()
  }

  // 录音期间在 window 上听松手。
  // 只挂按钮自己的 pointerup 是不够的：手指滑出按钮、或者浏览器把事件重定向到别处时都会漏。
  // 用 ref 拿最新的 finishRecording，避免闭包里拿到过期的 stage / 题号。
  const finishRef = useRef(finishRecording)
  finishRef.current = finishRecording

  useEffect(() => {
    if (stage !== 'recording') return
    const onUp = () => {
      // 松得太快 = 只是「点一下开始录」，让它继续录
      if (Date.now() - pressedAtRef.current < HOLD_MS) return
      void finishRef.current()
    }
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [stage])

  function goTo(n: number) {
    const next = Math.max(0, Math.min(n, order.length - 1))
    setStage('ready')
    clearClip()
    setLevels([])
    setElapsed(0)
    setSaveNote(null)
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        p.set('i', String(next))
        return p
      },
      { replace: true },
    )
  }

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      void a
        .play()
        .then(() => setPlaying(true))
        .catch(() => setError('回放失败，可能这段录音本机放不了'))
    } else {
      a.pause()
      setPlaying(false)
    }
  }

  if (loading) return <div className="screen-center">加载中…</div>

  if (!current) {
    return (
      <ErrorScreen
        message={error ?? '这一题读不出来'}
        action={{ label: '重新选范围', onClick: () => navigate('/review') }}
      />
    )
  }

  const pad = Math.max(0, BARS - levels.length)
  const bars = [...Array<number>(pad).fill(0), ...levels]

  return (
    <div className="screen screen-fill">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="navbar-action" onClick={() => navigate('/review')} aria-label="返回">
          ‹
        </button>
        <span className="t-caption color-text-2" style={{ flex: 1 }}>
          第 {index + 1} / {order.length} 题
        </span>
        {stage === 'compare' && (
          <span className="t-micro color-text-3">已录音 {formatClock((clip?.durationMs ?? 0))}</span>
        )}
      </div>

      <div className="progress-bar" style={{ marginTop: 12 }}>
        <span style={{ width: `${order.length ? ((index + 1) / order.length) * 100 : 0}%` }} />
      </div>

      {error && (
        <div className="inline-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      {toast && (
        <div className="inline-info" role="status" style={{ marginTop: 12 }}>
          {toast}
        </div>
      )}

      <div className="scroll-area" style={{ marginTop: 16 }}>
        {/* 题干：三个阶段都可见（边讲边看题） */}
        <div className={stage === 'compare' ? 't-title-2' : 't-title-1'}>{current.question}</div>

        {stage === 'recording' && (
          <>
            <div className="rec-line" style={{ marginTop: 16 }}>
              <span className="rec-dot" />
              <span className="t-body-strong" style={{ color: 'var(--danger)' }}>
                录音中
              </span>
              <span className="rec-time">{formatClock(elapsed)}</span>
            </div>
            <div className="wave" aria-hidden="true">
              {bars.map((lv, i) => (
                <span key={i} style={{ height: 6 + Math.round(lv * 18) }} />
              ))}
            </div>
            {elapsed > LONG_MS && (
              <div className="inline-info" style={{ marginTop: 12 }}>
                已经讲了 3 分钟，差不多可以收尾了
              </div>
            )}
          </>
        )}

        {stage !== 'compare' && (
          <div className="answer-hidden" style={{ marginTop: 16 }}>
            答案已隐藏
          </div>
        )}

        {/* ⚠️ 答案只在这里出现。放在条件里而不是用样式藏，是为了「答案根本不进 DOM」 */}
        {stage === 'compare' && (
          <>
            {/* 注意：这里判的是 clip 而不是 audioUrl。
                audioUrl 是在 useEffect 里才生成的，比「参考答案」晚一个 commit ——
                判它的话回放条会慢一帧才冒出来（测试里表现为偶发找不到，真机上就是闪一下）。 */}
            {clip && (
              <div className="replay-bar" style={{ marginTop: 16 }}>
                <button
                  type="button"
                  className="replay-play"
                  onClick={togglePlay}
                  disabled={!audioUrl}
                  aria-label={playing ? '暂停回放' : '播放回放'}
                >
                  {playing ? '❚❚' : '▶'}
                </button>
                <div className="replay-main">
                  <div className="t-caption color-text-2">回放我刚才说的</div>
                  <div className="replay-track">
                    <div className="replay-fill" style={{ width: `${dur > 0 ? (pos / dur) * 100 : 0}%` }} />
                    <input
                      type="range"
                      min={0}
                      max={dur > 0 ? dur : 1}
                      step={0.1}
                      value={pos}
                      aria-label="回放进度"
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (audioRef.current) audioRef.current.currentTime = v
                        setPos(v)
                      }}
                    />
                  </div>
                </div>
                <span className="t-micro color-text-3">{formatClock(clip.durationMs)}</span>
              </div>
            )}

            <hr className="divider" />
            <div className="t-title-2">参考答案</div>
            <div className="t-body color-text-2" style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>
              {current.answer}
            </div>

            {/* 对照答案时把「回答重点」亮出来：AI 提炼的得分点 + 你改过的版本，
                帮你对着自己的录音评估讲没讲到。只在这里渲染，对照前不进 DOM。 */}
            <KeyPointsPanel
              key={seq}
              seq={seq}
              data={kp[seq]?.data ?? null}
              loading={kp[seq]?.loading ?? false}
              error={kp[seq]?.error ?? null}
              regenerating={regen[seq] ?? false}
              onSave={(pts) => handleSaveKeyPoints(seq, pts)}
              onRegenerate={() => handleRegenerate(seq)}
              onRetry={() => loadKeyPoints(seq)}
            />

            {/* 保存只在对照阶段出现：主动回忆之前不该有任何多余操作入口 */}
            {clip && (
              <>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: 16 }}
                  disabled={saving}
                  onClick={() => void saveThisClip()}
                >
                  {saving ? '保存中…' : '保存这段录音'}
                </button>
                {saveNote && (
                  <div className="inline-info" role="status" style={{ marginTop: 8 }}>
                    {saveNote}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            if (Number.isFinite(d) && d > 0) setDur(d)
          }}
          onEnded={() => {
            setPlaying(false)
            setPos(0)
            if (audioRef.current) audioRef.current.currentTime = 0
          }}
        />
      )}

      {stage === 'compare' ? (
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button
            type="button"
            className="btn-secondary"
            style={{ flex: 1 }}
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
          >
            上一题
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ flex: 1 }}
            disabled={index >= order.length - 1}
            onClick={() => goTo(index + 1)}
          >
            下一题
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className={`btn-mic${stage === 'recording' ? ' is-recording' : ''}`}
            aria-label={stage === 'recording' ? '结束录音' : '按住录音'}
            disabled={!supported}
            onPointerDown={onMicDown}
          >
            <span className="mic-glyph">{stage === 'recording' ? '■' : '●'}</span>
          </button>
          <div className="t-caption color-text-3">
            {!supported
              ? '这个浏览器不支持录音，请用 Safari 打开'
              : stage === 'recording'
                ? '松手或点「说完了」结束'
                : '按住说话，讲完松手'}
          </div>
          {stage === 'recording' && (
            <button type="button" className="btn-secondary" style={{ marginTop: 4 }} onClick={finishRecording}>
              说完了
            </button>
          )}
        </div>
      )}
    </div>
  )
}
