/**
 * 朗读（TTS）：只用 iOS 内置的 Web Speech API，不联网、零依赖、文本不出设备。
 *
 * iPhone 上三个专属坑，全部在这一个文件里兜住：
 *  1. **首次 speak() 必须在真实点击的同步调用栈里**，否则静默失败（连 setTimeout 里都不行）。
 *     调用方负责：开关被点下的那一次就是解锁手势，play() 里绝不给第一段加延时。
 *  2. **连播约 15 秒会被系统自动暂停** —— 用心跳 pause()/resume() 保活。
 *  3. **Utterance 不持有引用会被 GC，onend 永不触发、队列卡死** —— 播放期间全程持有引用。
 *
 * 另外两个已知限制，前端无解，只能认：
 *  - 静音拨片打开时完全无声，且没有任何 API 能检测
 *  - 锁屏 / 切后台必停（Web Speech 不产生音频会话），要后台听只能换成真实音频文件
 */

/**
 * 题目读完到答案之间的停顿。
 * 从 3 秒 → 1.5 秒 → 400 毫秒：用户明确要「基本不停顿」。
 * 留这 400 毫秒只是为了让两段音频不首尾粘连（完全为 0 会听成一句），
 * 不再承担「留时间回忆」的职责。
 */
export const PAUSE_BEFORE_ANSWER_MS = 400

/** 单段字数上限：Chrome 上超过约 200~250 字会把这一段中途掐断 */
const MAX_SEGMENT = 80

/** 保活心跳间隔，必须明显小于 iOS 的 15 秒 */
const KEEPALIVE_MS = 9000

/** 断句标点：优先在这些字符后面切，读起来才不像机器人 */
const BREAK_CHARS = '。！？；，、：,.!?;:'

/** 一段朗读内容：要么念一段文本，要么静默若干毫秒 */
export type Segment = { text: string } | { pauseMs: number }

export function isSpeechSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis !== 'undefined' &&
    typeof window.SpeechSynthesisUtterance === 'function'
  )
}

function isBreak(ch: string): boolean {
  return BREAK_CHARS.includes(ch)
}

/**
 * 把长文本切成不会中途被掐断的小段。
 * 优先在标点处断；一句话本身过长（没有标点）才硬切。
 */
export function splitForSpeech(text: string, maxLen: number = MAX_SEGMENT): string[] {
  const src = text.replace(/\s+/g, ' ').trim()
  if (!src) return []

  const out: string[] = []
  let buf = ''
  const flush = () => {
    if (buf.trim()) out.push(buf.trim())
    buf = ''
  }

  for (const ch of src) {
    buf += ch
    if (buf.length >= maxLen && isBreak(ch)) flush()
    else if (buf.length >= maxLen * 2) flush()
  }
  flush()
  return out
}

/** 一张卡片的朗读编排：题目 → 停顿 → 答案 */
export function segmentsForCard(
  question: string,
  answer: string,
  pauseMs: number = PAUSE_BEFORE_ANSWER_MS,
): Segment[] {
  const q = splitForSpeech(question).map((text): Segment => ({ text }))
  const a = splitForSpeech(answer).map((text): Segment => ({ text }))
  if (q.length === 0) return a
  if (a.length === 0) return q
  return [...q, { pauseMs }, ...a]
}

/** 「增强 / 神经网络」音色念出来明显不像机器人，遇到就优先用 */
const GOOD_VOICE = /enhanced|premium|neural|siri|super|增强|高级|精品/i

/**
 * 挑一个中文音色。
 *
 * 打分而不是硬匹配：**增强版音色优先**——同一个 zh-CN 下，系统自带的紧凑版很机械，
 * 用户在系统里下载过的增强版（接近 Siri）要好得多。
 * 拿不到任何中文音色就返回 null，交给 utterance.lang 兜底。
 */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: string = 'zh-CN',
): SpeechSynthesisVoice | null {
  if (!voices || voices.length === 0) return null
  const lower = lang.toLowerCase()
  const prefix = lower.split('-')[0]

  let best: SpeechSynthesisVoice | null = null
  let bestScore = -1
  for (const v of voices) {
    const vl = v.lang.toLowerCase()
    if (!vl.startsWith(prefix)) continue
    const score =
      // 语言完全对上最重要：用 zh-TW 念简体中文，音调是错的
      (vl === lower ? 100 : 0) +
      (GOOD_VOICE.test(v.name) ? 50 : 0) +
      // 本地音色不联网，延迟低
      (v.localService ? 1 : 0)
    if (score > bestScore) {
      bestScore = score
      best = v
    }
  }
  return best
}

// ── 音色预热 ──────────────────────────────────────────────────────
// iOS 上 getVoices() 首次调用经常返回空数组，要过一会儿才就绪。
// 只在播放那一刻同步取一次，很可能一个中文音色都拿不到 —— 系统就会拿默认音色
// （很可能是英文的）去念中文，听起来格外怪。所以进页面就先预热并缓存。

let cachedVoices: SpeechSynthesisVoice[] = []

function readVoices(allowEmpty: boolean): void {
  try {
    const list = window.speechSynthesis.getVoices()
    if (!list) return
    // iOS 上 getVoices() 会在就绪前返回空数组。主动调用允许用空结果重置（调用方明确要重读），
    // 被动的 voiceschanged 回调则只在有内容时才覆盖，免得把已经拿到的音色清掉。
    if (list.length > 0 || allowEmpty) cachedVoices = list
  } catch {
    /* 拿不到就下次再试 */
  }
}

// 具名常量：同一个引用重复 addEventListener 浏览器会自动去重，所以可以放心每次都注册
const onVoicesChanged = () => readVoices(false)

/** 进页面时调一次；重复调用无副作用（重读一遍音色列表，监听器也只注册一次） */
export function primeVoices(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  readVoices(true)
  try {
    window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged)
  } catch {
    /* 老 Safari 只支持 onvoiceschanged 属性 */
  }
}

/** 取当前已知的音色；缓存空就现取一次 */
export function currentVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices.length === 0) {
    try {
      const list = window.speechSynthesis.getVoices()
      if (list && list.length > 0) cachedVoices = list
    } catch {
      /* 忽略 */
    }
  }
  return cachedVoices
}

export interface Speaker {
  /** 播一段编排；会先停掉上一次。整段念完会回调 onDone（被 stop 打断时不回调） */
  play(segments: Segment[], opts?: { onDone?: () => void }): void
  /** 立刻停：翻题、关开关、离开页面都要调 */
  stop(): void
}

/**
 * 建一个播放器。同一个页面共用一个即可 —— 全局只有一个 speechSynthesis，
 * 多个实例互相 cancel 会打架。
 */
export function createSpeaker(opts: { rate?: number; lang?: string } = {}): Speaker {
  const rate = opts.rate ?? 1
  const lang = opts.lang ?? 'zh-CN'

  // 每播一次就换一个 runId，旧队列的回调靠它自杀，避免上一题的声音跑到这一题来
  let runId = 0
  let queue: Segment[] = []
  let cursor = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  // 持有引用防 GC（iOS 上不持有会导致 onend 永不触发）
  let held: SpeechSynthesisUtterance[] = []
  // 整段念完要通知调用方（连播要靠它翻页）。stop 时清空，被打断就不算念完
  let doneCallback: (() => void) | null = null

  function clearTimers() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (heartbeat !== null) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  function stop() {
    runId += 1
    cursor = 0
    queue = []
    clearTimers()
    held = []
    doneCallback = null
    try {
      window.speechSynthesis.cancel()
    } catch {
      // 某些浏览器在无待播内容时 cancel 会抛，无所谓
    }
  }

  function next(id: number) {
    if (id !== runId) return
    if (cursor >= queue.length) {
      clearTimers()
      held = []
      const cb = doneCallback
      doneCallback = null
      cb?.()
      return
    }

    const seg = queue[cursor]
    cursor += 1

    if ('pauseMs' in seg) {
      timer = setTimeout(() => next(id), seg.pauseMs)
      return
    }

    const u = new SpeechSynthesisUtterance(seg.text)
    u.lang = lang
    u.rate = rate
    const voice = pickVoice(currentVoices(), lang)
    if (voice) u.voice = voice
    held.push(u)
    // 出错也往下走：否则一段失败会让整条队列永久卡住
    u.onend = () => next(id)
    u.onerror = () => next(id)
    window.speechSynthesis.speak(u)
  }

  function startHeartbeat(id: number) {
    heartbeat = setInterval(() => {
      if (id !== runId) return
      const s = window.speechSynthesis
      // 只在真的在念的时候动，空闲时 pause 会把后续队列一起冻住
      if (s.speaking && !s.paused) {
        s.pause()
        s.resume()
      }
    }, KEEPALIVE_MS)
  }

  return {
    play(segments: Segment[], playOpts = {}) {
      // 只有真的在念才 cancel：首次播放走不到这里，第一段就能留在用户手势的调用栈里
      if (window.speechSynthesis.speaking || window.speechSynthesis.paused) stop()
      runId += 1
      const id = runId
      queue = segments
      cursor = 0
      clearTimers()
      held = []
      doneCallback = playOpts.onDone ?? null
      startHeartbeat(id)
      next(id)
    },
    stop,
  }
}
