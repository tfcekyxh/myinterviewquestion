import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PAUSE_BEFORE_ANSWER_MS,
  createSpeaker,
  currentVoices,
  isSpeechSupported,
  pickVoice,
  primeVoices,
  segmentsForCard,
  splitForSpeech,
} from './speech'

/** jsdom 里没有 Web Speech，自己造一个能手动推进的可控假实现 */
class FakeUtterance {
  text: string
  lang = ''
  rate = 1
  voice: unknown = null
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

interface FakeSynth {
  spoken: string[]
  cancels: number
  pauses: number
  resumes: number
  speaking: boolean
  paused: boolean
  voices: unknown[]
}

let synth: FakeSynth
/** 最近一次 speak 的 utterance —— 靠手动触发它的 onend 来推进队列 */
let pending: FakeUtterance | null = null

function installFake(voices: unknown[] = []) {
  synth = {
    spoken: [],
    cancels: 0,
    pauses: 0,
    resumes: 0,
    speaking: false,
    paused: false,
    voices,
  }
  const fake = {
    get speaking() {
      return synth.speaking
    },
    get paused() {
      return synth.paused
    },
    speak(u: FakeUtterance) {
      synth.spoken.push(u.text)
      synth.speaking = true
      pending = u
    },
    cancel() {
      synth.cancels += 1
      synth.speaking = false
      pending = null
    },
    pause() {
      synth.pauses += 1
      synth.paused = true
    },
    resume() {
      synth.resumes += 1
      synth.paused = false
    },
    getVoices: () => synth.voices,
    addEventListener: (_type: string, _fn: () => void) => undefined,
  }
  vi.stubGlobal('speechSynthesis', fake)
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
}

/** 把当前这段念完，队列才会往下走 */
function finishCurrent() {
  const u = pending
  pending = null
  synth.speaking = false
  u?.onend?.()
}

beforeEach(() => {
  installFake()
  // 音色缓存是模块级的单例，每个用例都重读一次，免得被上一个用例污染
  primeVoices()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('splitForSpeech', () => {
  it('空文本没有段', () => {
    expect(splitForSpeech('')).toEqual([])
    expect(splitForSpeech('   ')).toEqual([])
  })

  it('短文本就是一段', () => {
    expect(splitForSpeech('什么是闭包？')).toEqual(['什么是闭包？'])
  })

  it('长文本在标点处断开，不在半句话中间硬切', () => {
    const long = '第一句，说的是一件事，需要讲清楚。第二句，说的是另一件事，也要讲清楚。'
    const parts = splitForSpeech(long, 10)
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(p.endsWith('。') || p.endsWith('，')).toBe(true)
    expect(parts.join('')).toBe(long)
  })

  it('一整段没有标点时也能切开（否则会被浏览器中途掐断）', () => {
    const noPunct = '啊'.repeat(300)
    const parts = splitForSpeech(noPunct, 80)
    expect(parts.length).toBeGreaterThan(1)
    // 内容不能丢
    expect(parts.join('').length).toBe(300)
  })

  it('多余空白被压成一个空格', () => {
    expect(splitForSpeech('a  \n  b')).toEqual(['a b'])
  })
})

describe('pickVoice', () => {
  const voice = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice

  it('没有可选音色时返回 null（交给 lang 兜底）', () => {
    expect(pickVoice([])).toBeNull()
  })

  it('精确匹配优先于同语种的其他音色', () => {
    const voices = [voice('Ting-Ting', 'zh-TW'), voice('Xiaoxiao', 'zh-CN'), voice('Samantha', 'en-US')]
    expect(pickVoice(voices, 'zh-CN')?.name).toBe('Xiaoxiao')
  })

  it('没有精确匹配时退回同语种前缀', () => {
    const voices = [voice('Samantha', 'en-US'), voice('Ting-Ting', 'zh-HK')]
    expect(pickVoice(voices, 'zh-CN')?.name).toBe('Ting-Ting')
  })

  it('一个中文音色都没有就返回 null', () => {
    expect(pickVoice([voice('Samantha', 'en-US')], 'zh-CN')).toBeNull()
  })

  it('同一个语言下优先用增强音色（紧凑版很机械，增强版接近 Siri）', () => {
    const voices = [voice('Ting-Ting', 'zh-CN'), voice('Tingting (Enhanced)', 'zh-CN')]
    expect(pickVoice(voices, 'zh-CN')?.name).toBe('Tingting (Enhanced)')
  })

  it('增强音色不会因为语言不完全匹配就被选中 —— 用 zh-TW 念简体，音调是错的', () => {
    const voices = [voice('Xiaoxiao', 'zh-CN'), voice('Meijia (Premium)', 'zh-TW')]
    expect(pickVoice(voices, 'zh-CN')?.name).toBe('Xiaoxiao')
  })
})

describe('primeVoices', () => {
  it('getVoices 一开始是空的也没关系：voiceschanged 之后能补上', () => {
    // iOS 上首次 getVoices() 常返回 []，过一会儿才就绪。不预热的话，
    // 第一次念题时一个中文音色都挑不出来，系统会拿默认音色（可能是英文）去念中文。
    const listeners: (() => void)[] = []
    const good = [{ name: 'Tingting (Enhanced)', lang: 'zh-CN' }] as SpeechSynthesisVoice[]
    let ready = false
    vi.stubGlobal('speechSynthesis', {
      speaking: false,
      paused: false,
      speak: () => undefined,
      cancel: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      getVoices: () => (ready ? good : []),
      addEventListener: (type: string, fn: () => void) => {
        if (type === 'voiceschanged') listeners.push(fn)
      },
    })

    primeVoices()
    ready = true
    listeners.forEach((fn) => fn())

    expect(listeners.length).toBeGreaterThan(0)
    expect(currentVoices().some((v) => v.name === 'Tingting (Enhanced)')).toBe(true)
    expect(pickVoice(currentVoices(), 'zh-CN')?.name).toBe('Tingting (Enhanced)')
  })
})

describe('segmentsForCard', () => {
  it('题目 → 停顿 → 答案', () => {
    const segs = segmentsForCard('问题？', '答案。')
    expect(segs).toEqual([{ text: '问题？' }, { pauseMs: PAUSE_BEFORE_ANSWER_MS }, { text: '答案。' }])
  })

  it('题目很长时先切段再停顿，停顿只插一次', () => {
    const segs = segmentsForCard('啊'.repeat(200), '答案。')
    const pauses = segs.filter((s) => 'pauseMs' in s)
    expect(pauses).toHaveLength(1)
    // 停顿夹在题目最后一段和答案之间
    expect(segs.findIndex((s) => 'pauseMs' in s)).toBe(segs.length - 2)
  })

  it('缺答案时不插停顿', () => {
    expect(segmentsForCard('问题？', '')).toEqual([{ text: '问题？' }])
  })

  it('缺题目时不插停顿', () => {
    expect(segmentsForCard('', '答案。')).toEqual([{ text: '答案。' }])
  })
})

describe('createSpeaker', () => {
  it('按顺序念完题和答案：一段结束才念下一段', () => {
    vi.useFakeTimers()
    const speaker = createSpeaker()
    speaker.play(segmentsForCard('第一问？', '第一答。'))

    expect(synth.spoken).toEqual(['第一问？'])
    finishCurrent()
    vi.advanceTimersByTime(PAUSE_BEFORE_ANSWER_MS)
    expect(synth.spoken).toEqual(['第一问？', '第一答。'])
  })

  it('题目念完后停一下再念答案，留给自己回忆', () => {
    vi.useFakeTimers()
    const speaker = createSpeaker()
    speaker.play(segmentsForCard('第一问？', '第一答。'))

    finishCurrent()
    // 停顿期间不该出声
    expect(synth.spoken).toEqual(['第一问？'])
    vi.advanceTimersByTime(PAUSE_BEFORE_ANSWER_MS - 1)
    expect(synth.spoken).toEqual(['第一问？'])

    vi.advanceTimersByTime(1)
    expect(synth.spoken).toEqual(['第一问？', '第一答。'])
  })

  it('某一段报错也继续往下走，不把整条队列卡死', () => {
    vi.useFakeTimers()
    const speaker = createSpeaker()
    speaker.play(segmentsForCard('第一问？', '第一答。'))

    const u = pending
    pending = null
    synth.speaking = false
    u?.onerror?.()
    vi.advanceTimersByTime(PAUSE_BEFORE_ANSWER_MS)

    expect(synth.spoken).toEqual(['第一问？', '第一答。'])
  })

  it('首次播放不调 cancel —— iOS 只认用户手势里的那次 speak', () => {
    const speaker = createSpeaker()
    speaker.play([{ text: '题' }])
    expect(synth.cancels).toBe(0)
  })

  it('正在念的时候重新 play：先停旧的，再念新的', () => {
    const speaker = createSpeaker()
    speaker.play([{ text: '旧题' }])
    synth.speaking = true

    speaker.play([{ text: '新题' }])
    expect(synth.cancels).toBe(1)
    expect(synth.spoken).toEqual(['旧题', '新题'])
  })

  it('stop 之后，旧队列的回调不会再念出声', () => {
    const speaker = createSpeaker()
    speaker.play(segmentsForCard('旧问？', '旧答。'))
    speaker.stop()

    const stale = pending
    stale?.onend?.()
    expect(synth.spoken).toEqual(['旧问？'])
    expect(synth.cancels).toBe(1)
  })

  it('每 9 秒做一次 pause/resume 保活（iOS 连播 15 秒会被系统掐断）', () => {
    vi.useFakeTimers()
    const speaker = createSpeaker()
    speaker.play([{ text: '很长的一段' }])

    vi.advanceTimersByTime(9_000)
    expect(synth.pauses).toBe(1)
    expect(synth.resumes).toBe(1)

    vi.advanceTimersByTime(9_000)
    expect(synth.pauses).toBe(2)
  })

  it('空闲时不做保活 —— 否则会把还没开始的队列冻住', () => {
    vi.useFakeTimers()
    const speaker = createSpeaker()
    speaker.play([{ text: '题' }])
    synth.speaking = false

    vi.advanceTimersByTime(30_000)
    expect(synth.pauses).toBe(0)
  })

  it('整段念完会回调 onDone（连播要靠它翻页）', () => {
    vi.useFakeTimers()
    const onDone = vi.fn()
    const speaker = createSpeaker()
    speaker.play(segmentsForCard('第一问？', '第一答。'), { onDone })

    finishCurrent()
    vi.advanceTimersByTime(PAUSE_BEFORE_ANSWER_MS)
    expect(onDone).not.toHaveBeenCalled() // 答案还没念

    finishCurrent()
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('被 stop 打断就不算念完，不回调 onDone', () => {
    const onDone = vi.fn()
    const speaker = createSpeaker()
    speaker.play(segmentsForCard('第一问？', '第一答。'), { onDone })

    speaker.stop()
    finishCurrent()
    expect(onDone).not.toHaveBeenCalled()
  })

  it('念出来的每段都带中文 lang', () => {
    installFake([{ name: 'Xiaoxiao', lang: 'zh-CN' } as SpeechSynthesisVoice])
    const speaker = createSpeaker()
    speaker.play([{ text: '题' }])
    expect(pending?.lang).toBe('zh-CN')
    expect((pending?.voice as { name: string } | null)?.name).toBe('Xiaoxiao')
  })
})

describe('isSpeechSupported', () => {
  it('装上 Web Speech 就是支持', () => {
    expect(isSpeechSupported()).toBe(true)
  })

  it('没有 Web Speech 时明确不支持（页面据此隐藏开关）', () => {
    vi.stubGlobal('speechSynthesis', undefined)
    expect(isSpeechSupported()).toBe(false)
  })
})
