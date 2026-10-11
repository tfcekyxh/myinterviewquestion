// 录音抽象层。组件只依赖这里的接口，不直接碰 MediaRecorder。
//
// 为什么必须抽出来（实测结论）：
//   jsdom 里**没有 MediaRecorder、也没有 navigator.mediaDevices**。
//   如果录音逻辑写在组件里，复习页的组件测试根本没法写（一进页面就炸）。
//   抽成接口后，组件测试用 vi.mock 换成桩，真录音只在 e2e / 真机上跑。
//
// 另一个必须守住的点：**文件扩展名绝不能写死 .webm**。
//   不同浏览器给的 container 不一样（Chromium 实测是 audio/mp4;codecs=opus，iPhone 是 audio/mp4），
//   所以扩展名一律由 recorder.mimeType 推导，见 extForMime()。

export type RecorderState = 'idle' | 'recording'

export interface Recording {
  blob: Blob
  /** 浏览器实际给出的类型，扩展名由它推导 */
  mimeType: string
  durationMs: number
}

export interface Recorder {
  readonly state: RecorderState
  /** 开始录音。权限被拒 / 无设备会抛出 RecorderError（带中文可读原因） */
  start(): Promise<void>
  /** 结束并返回录音；录到的内容为空时返回 null */
  stop(): Promise<Recording | null>
  /** 丢弃当前录音 */
  cancel(): void
  /** 实时音量 0..1，用于波形 */
  setLevelHandler(cb: ((level: number) => void) | null): void
  dispose(): void
}

export class RecorderError extends Error {}

/** 录音所选的候选类型。顺序有讲究：iPhone 只认 mp4，先试它。 */
const MIME_CANDIDATES = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
]

/** 当前环境能不能录音（用于在页面上「提前」给出提示，而不是等用户按了才报错） */
export function isRecorderSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

/** 挑一个浏览器支持的音频类型；都不支持就返回 undefined，交给浏览器自己决定 */
export function pickMimeType(
  isSupported: (t: string) => boolean = defaultTypeSupported,
): string | undefined {
  return MIME_CANDIDATES.find((t) => isSupported(t))
}

function defaultTypeSupported(t: string): boolean {
  if (typeof MediaRecorder === 'undefined') return false
  return MediaRecorder.isTypeSupported?.(t) ?? false
}

/**
 * 由 mimeType 推导扩展名。**这是「不许写死 .webm」这条约束的落点。**
 * 例：audio/mp4;codecs=opus → m4a；audio/webm;codecs=opus → webm
 */
export function extForMime(mimeType: string): string {
  const m = (mimeType || '').toLowerCase()
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a'
  if (m.includes('webm')) return 'webm'
  if (m.includes('ogg') || m.includes('opus')) return 'ogg'
  if (m.includes('wav')) return 'wav'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  return 'bin'
}

/** 录音文件名：带上题号与时间，导出时不至于全叫 recording.m4a */
export function clipFileName(seq: number, mimeType: string, at: number = Date.now()): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `第${seq}题-${stamp}.${extForMime(mimeType)}`
}

function describeGetUserMediaError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '麦克风权限被拒绝。请在 Safari 的「网站设置」里允许麦克风后重试'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return '没有找到可用的麦克风'
  }
  if (name === 'NotReadableError') {
    return '麦克风被其他程序占用了，请关掉其他录音应用再试'
  }
  return `无法开始录音：${e instanceof Error ? e.message : String(e)}`
}

/** 录音时长显示：00:14 / 03:07 */
export function formatClock(ms: number): string {
  // NaN / Infinity 都要退成 00:00：Math.max(0, NaN) 还是 NaN，只靠 max 拦不住
  const safe = Number.isFinite(ms) ? Math.max(0, ms) : 0
  const total = Math.floor(safe / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function createRecorder(): Recorder {
  let state: RecorderState = 'idle'
  let media: MediaRecorder | null = null
  let stream: MediaStream | null = null
  let chunks: Blob[] = []
  let startedAt = 0
  let rafId = 0
  let audioCtx: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let levelHandler: ((level: number) => void) | null = null
  let lastLevelAt = 0
  // stop() 是异步的，用 Promise 等 onstop；同时防止重复 stop
  let stopping: Promise<Recording | null> | null = null

  function teardown() {
    if (rafId) cancelAnimationFrame(rafId)
    rafId = 0
    // 必须把所有 track 停掉，否则 iPhone 上顶部会一直显示「正在录音」
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    if (audioCtx && audioCtx.state !== 'closed') void audioCtx.close().catch(() => undefined)
    audioCtx = null
    analyser = null
    media = null
    chunks = []
    state = 'idle'
  }

  /**
   * 建音频分析链路。
   *
   * ⚠️ 必须在**用户手势的同一个任务里**先 new AudioContext（所以是在 await getUserMedia 之前调），
   * 否则 iOS 上新建出来的 AudioContext 是 suspended 状态，AnalyserNode 永远读到静音 ——
   * 症状是「录音正常，但波形一直贴着底」。resume() 兜一下，但手势过期后 resume 也救不回来。
   */
  function openMeter() {
    if (typeof AudioContext === 'undefined') return
    try {
      audioCtx = new AudioContext()
    } catch {
      audioCtx = null
      return
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => undefined)
  }

  /** 拿到 stream 之后才接得上分析节点 */
  function wireMeter() {
    if (!audioCtx || !stream || audioCtx.state === 'closed') return
    try {
      const src = audioCtx.createMediaStreamSource(stream)
      analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      src.connect(analyser)
    } catch {
      // 量不出音量不影响录音本身，波形退化成静态即可
      analyser = null
      return
    }
    const buf = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (state !== 'recording' || !analyser) return
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (const v of buf) {
        const d = (v - 128) / 128
        sum += d * d
      }
      const rms = Math.sqrt(sum / buf.length)
      // 约 12fps 就够了，波形不需要 60fps，省电
      const now = Date.now()
      if (now - lastLevelAt > 80) {
        lastLevelAt = now
        levelHandler?.(Math.min(1, rms * 3.5))
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
  }

  async function start() {
    if (state === 'recording') return
    if (!isRecorderSupported()) {
      throw new RecorderError('这个浏览器不支持录音，请用 Safari 打开')
    }

    // 先建 AudioContext：此刻还在 pointerdown 的手势里
    openMeter()

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      teardown()
      throw new RecorderError(describeGetUserMediaError(e))
    }

    const mimeType = pickMimeType()
    try {
      media = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
    } catch {
      // 浏览器嘴上支持、实际拒绝这个类型时，退回让它自己选
      media = new MediaRecorder(stream)
    }

    chunks = []
    media.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    media.start()
    startedAt = Date.now()
    state = 'recording'
    wireMeter()
  }

  async function stop(): Promise<Recording | null> {
    if (stopping) return stopping
    if (state !== 'recording' || !media) return null

    const rec = media
    const mimeType = rec.mimeType || chunks[0]?.type || 'audio/mp4'
    const durationMs = Date.now() - startedAt

    stopping = (async () => {
      const ended = new Promise<void>((resolve) => {
        rec.onstop = () => resolve()
        // 有些浏览器不给 onstop 回调，兜一个超时，绝不让 UI 卡在「录音中」
        setTimeout(resolve, 1500)
      })
      try {
        rec.stop()
      } catch {
        /* 已经停了就算了 */
      }
      await ended
      const blob = new Blob(chunks, { type: mimeType })
      const size = blob.size
      teardown()
      stopping = null
      if (size === 0) return null // 按一下就松手，什么都没录到
      return { blob, mimeType, durationMs }
    })()

    return stopping
  }

  function cancel() {
    if (state === 'recording' && media) {
      try {
        media.stop()
      } catch {
        /* ignore */
      }
    }
    teardown()
    stopping = null
  }

  return {
    get state() {
      return state
    },
    start,
    stop,
    cancel,
    setLevelHandler(cb) {
      levelHandler = cb
    },
    dispose() {
      cancel()
      levelHandler = null
    },
  }
}
