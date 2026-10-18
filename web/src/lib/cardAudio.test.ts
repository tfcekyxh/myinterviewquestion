import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAUSE_BEFORE_ANSWER_MS } from './speech'
import { createAudioPlayer, isWarm, resetServerAudio, warmSegment, withTimeout } from './cardAudio'

/** createAudioPlayer 自己 new 出来的 Audio 拿不到，靠子类化把它接出来 */
const audios: HTMLAudioElement[] = []

function stubAudio() {
  audios.length = 0
  vi.stubGlobal(
    'Audio',
    class extends Audio {
      constructor(src?: string) {
        super(src)
        audios.push(this)
      }
    },
  )
}

/** 手动把当前这段播完，队列才会往下走 */
function finishCurrent() {
  const el = audios[audios.length - 1]
  const fn = el.onended
  // onended 的类型要求 this 是元素本身，直接 fn() 过不了类型检查
  if (fn) fn.call(el, new Event('ended'))
}

function fakeFetch(ok: boolean) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 503,
    // 必须提供 arrayBuffer：预取要读完 body，响应才会进 HTTP 缓存
    arrayBuffer: async () => new ArrayBuffer(8),
  }))
}

beforeEach(() => {
  resetServerAudio()
  stubAudio()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('warmSegment', () => {
  it('预取成功后这一段就算「热」了，播的时候才敢直接用', async () => {
    const fetchMock = fakeFetch(true)
    vi.stubGlobal('fetch', fetchMock)

    expect(isWarm(1, 'q')).toBe(false)
    await warmSegment(1, 'q')
    expect(isWarm(1, 'q')).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/tts/1/q')
  })

  it('同一段只发一个请求（预取和播放可能同时要它）', async () => {
    const fetchMock = fakeFetch(true)
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([warmSegment(1, 'q'), warmSegment(1, 'q')])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('失败的可以重试 —— 一次失败不能判死整场会话', async () => {
    const bad = fakeFetch(false)
    vi.stubGlobal('fetch', bad)
    await expect(warmSegment(2, 'a')).rejects.toThrow()
    expect(isWarm(2, 'a')).toBe(false)

    const good = fakeFetch(true)
    vi.stubGlobal('fetch', good)
    await warmSegment(2, 'a')
    expect(isWarm(2, 'a')).toBe(true)
  })

  it('进页重置会清掉预热记录', async () => {
    vi.stubGlobal('fetch', fakeFetch(true))
    await warmSegment(3, 'q')
    expect(isWarm(3, 'q')).toBe(true)
    resetServerAudio()
    expect(isWarm(3, 'q')).toBe(false)
  })
})

describe('withTimeout', () => {
  it('超时就拒绝，不能让答案无限等下去', async () => {
    vi.useFakeTimers()
    const p = withTimeout(new Promise(() => undefined), 1000)
    const settled = vi.fn()
    p.then(settled, settled)
    vi.advanceTimersByTime(1000)
    await p.catch(() => undefined)
    expect(settled).toHaveBeenCalled()
  })
})

function playerOpts(answerUrl: string | null = '/api/tts/1/a', pauseMs = 1000) {
  return {
    pauseMs,
    title: '题目',
    getAnswerUrl: async () => answerUrl,
    onAnswerUnavailable: vi.fn(),
  }
}

describe('createAudioPlayer', () => {
  it('用真实 URL 播，不用 blob（iOS 上 blob 不稳，也不好锁屏播）', () => {
    const player = createAudioPlayer()
    player.play('/api/tts/1/q', playerOpts())
    expect(audios[audios.length - 1].src).toContain('/api/tts/1/q')
  })

  it('先念题目，题目念完停一下，再念答案', async () => {
    vi.useFakeTimers()
    const player = createAudioPlayer()
    player.play('/api/tts/1/q', playerOpts())
    const el = audios[audios.length - 1]
    expect(el.src).toContain('/api/tts/1/q')

    finishCurrent()
    vi.advanceTimersByTime(999)
    expect(el.src).toContain('/api/tts/1/q')

    await vi.advanceTimersByTimeAsync(1)
    // getAnswerUrl 是 async，还要再让一个微任务周期过去才会换源
    await vi.advanceTimersByTimeAsync(0)
    expect(el.src).toContain('/api/tts/1/a')
  })

  it('停顿时长和内置朗读保持一致', async () => {
    vi.useFakeTimers()
    const player = createAudioPlayer()
    player.play('/api/tts/1/q', playerOpts('/api/tts/1/a', PAUSE_BEFORE_ANSWER_MS))
    const el = audios[audios.length - 1]

    finishCurrent()
    await vi.advanceTimersByTimeAsync(PAUSE_BEFORE_ANSWER_MS - 1)
    expect(el.src).toContain('/api/tts/1/q')

    await vi.advanceTimersByTimeAsync(1)
    // getAnswerUrl 是 async，还要再让一个微任务周期过去才会换源
    await vi.advanceTimersByTimeAsync(0)
    expect(el.src).toContain('/api/tts/1/a')
  })

  it('答案音频拿不到时通知调用方补念，不能整段没了', async () => {
    vi.useFakeTimers()
    const opts = playerOpts(null, PAUSE_BEFORE_ANSWER_MS)
    const player = createAudioPlayer()
    player.play('/api/tts/1/q', opts)

    finishCurrent()
    await vi.advanceTimersByTimeAsync(PAUSE_BEFORE_ANSWER_MS)
    expect(opts.onAnswerUnavailable).toHaveBeenCalled()
  })

  it('stop 之后旧的回调不再往下播', async () => {
    vi.useFakeTimers()
    const player = createAudioPlayer()
    player.play('/api/tts/1/q', playerOpts())
    const el = audios[audios.length - 1]

    player.stop()
    finishCurrent()
    await vi.advanceTimersByTimeAsync(5000)
    expect(el.src).toContain('/api/tts/1/q')
  })

  it('答案音频是「边念题目边下」的 —— 不然停顿时长会等于下载时间加停顿', async () => {
    vi.useFakeTimers()
    const order: string[] = []
    const player = createAudioPlayer()
    player.play('/api/tts/1/q', {
      pauseMs: 1000,
      title: '题目',
      getAnswerUrl: async () => {
        order.push('开始取答案')
        await new Promise((r) => setTimeout(r, 500))
        order.push('答案到手')
        return '/api/tts/1/a'
      },
      onAnswerUnavailable: vi.fn(),
    })

    // 题目一开播就该开始取答案，而不是等题目念完
    expect(order).toContain('开始取答案')
    finishCurrent()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(audios[audios.length - 1].src).toContain('/api/tts/1/a')
  })

  it('念完答案回调 onDone（连播要靠它翻页）', async () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const player = createAudioPlayer()
    player.play('/api/tts/1/q', { ...playerOpts('/api/tts/1/a', 1000), onDone })

    finishCurrent()
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(0)
    expect(onDone).not.toHaveBeenCalled() // 答案刚开始播

    finishCurrent()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('unlock 播一段静音，好让 iOS 允许后面异步播放', () => {
    const player = createAudioPlayer()
    player.unlock()
    expect(audios[audios.length - 1].src).toContain('data:audio/wav')
  })
})
