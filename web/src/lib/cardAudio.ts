/**
 * 卡片音频：优先用服务端生成的 MP3（音质好、能锁屏听），拿不到就退回 iOS 内置朗读。
 *
 * 三条踩过的坑，改这块前先看：
 *  1. **必须预取**：iOS 上 `<audio>` 和 `speechSynthesis` 一样，第一次出声必须在
 *     用户手势的同步调用栈里。等下载完再 play 就脱离手势了，会静默失败。
 *  2. **题目和答案要分开**：题目约 1 秒生成完，答案要 7 秒（线上实测）。
 *     早期版本要求两段都到齐才用服务端音频，结果用户点开关时答案多半还没好，
 *     整张卡都退回本机朗读 —— 表现就是「电脑上是 Xiaoxiao，手机上还是机械音」。
 *     现在题目一到就播，答案在停顿那几秒里继续下。
 *  3. **src 用真实 URL，不用 blob**：iOS 对 blob URL 的音频支持不稳，而且 blob 常驻内存
 *     （答案 600KB/段），锁屏后还可能放不出来。改成同一 URL 走 HTTP 缓存，
 *     预取只是把响应塞进浏览器缓存，播放时命中缓存即可秒开。
 */
import { PAUSE_BEFORE_ANSWER_MS } from './speech'

export type Part = 'q' | 'a'

/** 等答案音频的最长时间。超过就退回本机朗读，不能让用户干等 */
export const ANSWER_WAIT_MS = 20_000

/** 已经预取过的段落。只记「热没热」，音频本身交给浏览器的 HTTP 缓存 */
const warmed = new Set<string>()
/** 进行中的预取，用来去重：预取和播放可能同时要同一段 */
const inflight = new Map<string, Promise<void>>()

const keyOf = (seq: number, part: Part) => `${seq}:${part}`

export function segmentUrl(seq: number, part: Part): string {
  return `/api/tts/${seq}/${part}`
}

/** 同步判断这段音频是不是已经预取好了。播放时必须能同步判断，不然就脱离手势栈了 */
export function isWarm(seq: number, part: Part): boolean {
  return warmed.has(keyOf(seq, part))
}

/**
 * 把一段音频预取进浏览器缓存。
 * 之后 `<audio src>` 用同一个地址就能命中缓存，不必再下载一遍。
 */
export async function warmSegment(seq: number, part: Part): Promise<void> {
  const key = keyOf(seq, part)
  if (warmed.has(key)) return
  const hit = inflight.get(key)
  if (hit) return hit

  const task = (async () => {
    const res = await fetch(segmentUrl(seq, part))
    if (!res.ok) throw new Error(`音频请求失败：${res.status}`)
    // 必须把 body 读完，响应才会进 HTTP 缓存；读完就丢掉，不占内存
    await res.arrayBuffer()
    warmed.add(key)
  })()

  inflight.set(key, task)
  try {
    await task
  } finally {
    inflight.delete(key)
  }
}

/** 进背诵页时调一次：清掉预取记录（音频本身在 HTTP 缓存里，重新取很快） */
export function resetServerAudio(): void {
  warmed.clear()
}

/** 给任意 Promise 加超时：答案音频可能很久，不能无限等下去 */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等音频超时')), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// 44 字节的静音 WAV。用它「骗」一次真实播放，好让 iOS 允许后续异步播放。
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA'

export interface AudioPlayer {
  /**
   * 念题目 → 停一会儿 → 念答案。
   * 答案音频可能还没好，所以由 getAnswerUrl 在需要时才去取 ——
   * 题目先出声，答案在停顿那几秒里继续下。
   */
  play(
    questionUrl: string,
    opts: {
      pauseMs?: number
      title?: string
      getAnswerUrl: () => Promise<string | null>
      /** 答案音频没来，交给调用方用本机朗读补念 */
      onAnswerUnavailable: () => void
      /** 整张卡念完了（连播要靠它翻页） */
      onDone?: () => void
    },
  ): void
  /** 立刻停。翻题、关开关、离开页面都要调 */
  stop(): void
  /**
   * 在用户手势的同步栈里调一次，播一段听不见的静音。
   * 之后这个元素就能异步播放了 —— 万一题目是用本机朗读念的，
   * 答案音频晚点到也能接上去播。
   */
  unlock(): void
}

/**
 * 用一个 `<audio>` 串起两段。
 * ⚠️ 换 src 之后 `autoplay` 不会再触发，必须自己调 `play()`。
 */
export function createAudioPlayer(): AudioPlayer {
  const el = new Audio()
  el.preload = 'auto'

  let token = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let unlocked = false

  function stop() {
    token += 1
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    el.pause()
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'none'
    }
  }

  function setSrc(url: string, id: number, onEnd: () => void) {
    el.src = url
    el.onended = () => {
      if (id !== token) return
      onEnd()
    }
    el.onerror = () => {
      if (id !== token) return
      onEnd() // 这段放不出来就往下走，别把整张卡卡住
    }
    // play() 可能被系统拒绝（没解锁 / 被别的音频打断），不当成致命错误
    void el.play().catch(() => undefined)
  }

  return {
    unlock() {
      if (unlocked) return
      unlocked = true
      try {
        el.src = SILENT_WAV
        void el.play().catch(() => undefined)
      } catch {
        // 解锁失败不影响后面的兜底
      }
    },

    play(questionUrl, opts) {
      stop()
      const id = token
      const pauseMs = opts.pauseMs ?? PAUSE_BEFORE_ANSWER_MS
      // 答案音频**现在就开始下**，不等题目念完 —— 否则停顿时长会等于「下载时间 + 停顿」
      const answerPromise = opts.getAnswerUrl().catch(() => null)

      // 锁屏/控制中心能看到在念什么，也能暂停
      if ('mediaSession' in navigator && opts.title) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: opts.title,
            artist: '面试题背诵',
          })
          navigator.mediaSession.playbackState = 'playing'
          navigator.mediaSession.setActionHandler('play', () => void el.play().catch(() => undefined))
          navigator.mediaSession.setActionHandler('pause', () => el.pause())
        } catch {
          // 不支持就算了，不影响播放
        }
      }

      setSrc(questionUrl, id, async () => {
        // 停顿和「等答案」同时进行：答案早到了就只停够 pauseMs，晚到了才多等一会儿
        const [answerUrl] = await Promise.all([
          answerPromise,
          new Promise<void>((r) => {
            timer = setTimeout(r, pauseMs)
          }),
        ])
        if (id !== token) return
        if (answerUrl) {
          setSrc(answerUrl, id, () => {
            if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none'
            opts.onDone?.()
          })
        } else {
          // 答案音频终究没来：交给调用方用本机朗读把答案念完，不能整段没了
          opts.onAnswerUnavailable()
        }
      })
    },

    stop,
  }
}
