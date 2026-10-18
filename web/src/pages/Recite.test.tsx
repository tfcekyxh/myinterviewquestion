import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Recite from './Recite'
import { fetchFullBank, fetchProgress, saveProgress, type ProgressState, type Question } from '../lib/api'
import { PAUSE_BEFORE_ANSWER_MS } from '../lib/speech'
import { isWarm } from '../lib/cardAudio'

/** jsdom 没有 Web Speech，补一个只记录「念了什么」的可控假实现 */
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

let spoken: string[] = []
let cancels = 0
let pendingUtterance: FakeUtterance | null = null

/** 服务端音频接口。ok=false 模拟「沙箱没外网 / 生成失败」 */
function fakeFetch(ok: boolean) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 503,
    // 预热要把 body 读完响应才进 HTTP 缓存，所以必须提供 arrayBuffer
    arrayBuffer: async () => new ArrayBuffer(8),
  }))
}

function installSpeech() {
  spoken = []
  cancels = 0
  pendingUtterance = null
  let speaking = false
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  vi.stubGlobal('speechSynthesis', {
    get speaking() {
      return speaking
    },
    paused: false,
    speak(u: FakeUtterance) {
      spoken.push(u.text)
      speaking = true
      pendingUtterance = u
    },
    cancel() {
      cancels += 1
      speaking = false
      pendingUtterance = null
    },
    pause() {},
    resume() {},
    getVoices: () => [],
  })
}

vi.mock('../lib/api', () => ({
  fetchFullBank: vi.fn(),
  fetchProgress: vi.fn(),
  saveProgress: vi.fn(),
}))

const mockedBank = vi.mocked(fetchFullBank)
const mockedProgress = vi.mocked(fetchProgress)
const mockedSave = vi.mocked(saveProgress)

const QUESTIONS: Question[] = [1, 2, 3, 4].map((seq) => ({
  seq,
  question: `问题 ${seq}？`,
  answer: `答案 ${seq}`,
}))

function progress(over: Partial<ProgressState> = {}): ProgressState {
  return { mode: 'order', posOrder: 0, posRandom: 0, randOrder: [], roundStart: null, lastRound: null, total: 4, updatedAt: null, ...over }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Recite />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedBank.mockReset()
  mockedProgress.mockReset()
  mockedSave.mockReset()
  mockedBank.mockResolvedValue({ total: 4, source: '题库.pdf', importedAt: 1, questions: QUESTIONS })
  mockedProgress.mockResolvedValue(progress())
  mockedSave.mockResolvedValue(progress())
  localStorage.clear()
  installSpeech()
  // 默认让服务端音频不可用：既有用例断言的是 iOS 内置朗读。
  // 不走真的网络请求，也避免每次都白等一个超时。
  vi.stubGlobal('fetch', fakeFetch(false))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Recite · 题答同屏', () => {
  it('题干和答案同时可见（本期决策：不翻面）', async () => {
    renderPage()

    expect(await screen.findByText('问题 1？')).toBeInTheDocument()
    expect(screen.getByText('答案 1')).toBeInTheDocument()
    // 不应存在任何「显示答案」入口
    expect(screen.queryByRole('button', { name: /显示答案|查看答案/ })).not.toBeInTheDocument()
  })

  it('顶部显示第几题与总数', async () => {
    renderPage()
    expect(await screen.findByText('第 1 / 4 题')).toBeInTheDocument()
  })

  it('进度来自服务端：存的是第 3 题就直接停在第 3 题（刷新不掉队）', async () => {
    mockedProgress.mockResolvedValue(progress({ posOrder: 2 }))
    renderPage()

    expect(await screen.findByText('第 3 / 4 题')).toBeInTheDocument()
    expect(screen.getByText('问题 3？')).toBeInTheDocument()
  })

  it('没有题库时给出明确提示，不白屏', async () => {
    mockedBank.mockResolvedValue({ total: 0, source: null, importedAt: null, questions: [] })
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('还没有题库')
  })
})

describe('Recite · 边界', () => {
  it('第一题时「上一题」禁用', async () => {
    renderPage()
    await screen.findByText('第 1 / 4 题')
    expect(screen.getByRole('button', { name: '上一题' })).toBeDisabled()
  })

  it('点「下一题」前进一题，并把进度写回服务端', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('第 1 / 4 题')

    await user.click(screen.getByRole('button', { name: '下一题' }))

    expect(await screen.findByText('第 2 / 4 题')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一题' })).toBeEnabled()
    await waitFor(() => expect(mockedSave).toHaveBeenCalledWith({ posOrder: 1 }))
  })

  it('最后一题：按钮变成「背完了」，点完提示这一轮背完了', async () => {
    const user = userEvent.setup()
    mockedProgress.mockResolvedValue(progress({ posOrder: 3 }))
    renderPage()
    await screen.findByText('第 4 / 4 题')

    const last = screen.getByRole('button', { name: '背完了' })
    await user.click(last)

    expect(await screen.findByText('这一轮背完了')).toBeInTheDocument()
    await waitFor(() => expect(mockedSave).toHaveBeenCalledWith({ posOrder: 4 }))
  })
})

describe('Recite · 顺序 / 随机', () => {
  it('切到随机：题目换成打乱后的顺序，且写回了一条 1..N 的排列', async () => {
    const user = userEvent.setup()
    // 固定随机源，让洗牌结果确定（否则这个用例会偶发失败）
    vi.spyOn(Math, 'random').mockReturnValue(0)
    renderPage()
    await screen.findByText('问题 1？')

    await user.click(screen.getByRole('button', { name: '随机' }))

    // 原序第一位是「问题 1」，打乱后不该还是它
    await waitFor(() => expect(screen.queryByText('问题 1？')).not.toBeInTheDocument())
    expect(screen.getByText('已切换为随机')).toBeInTheDocument()

    const patch = mockedSave.mock.calls.map((c) => c[0]).find((p) => p.mode === 'random')
    expect(patch).toBeTruthy()
    expect(patch!.randOrder!.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(patch!.posRandom).toBe(0)
  })

  it('切回顺序：恢复原序，且顺序模式的位置没被随机模式顶掉', async () => {
    const user = userEvent.setup()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    mockedProgress.mockResolvedValue(progress({ posOrder: 2 }))
    renderPage()
    await screen.findByText('问题 3？')

    await user.click(screen.getByRole('button', { name: '随机' }))
    await waitFor(() => expect(screen.queryByText('问题 3？')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '顺序' }))

    // 回到顺序模式后仍然是第 3 题 —— 这正是「顺序/随机各存一个位置」的目的
    expect(await screen.findByText('问题 3？')).toBeInTheDocument()
    expect(screen.getByText('第 3 / 4 题')).toBeInTheDocument()
    expect(screen.getByText('已切换为顺序')).toBeInTheDocument()
  })

  it('再点一次「随机」= 换一批（重新洗牌）', async () => {
    const user = userEvent.setup()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    renderPage()
    await screen.findByText('问题 1？')

    await user.click(screen.getByRole('button', { name: '随机' }))
    await waitFor(() => expect(mockedSave.mock.calls.some((c) => c[0].mode === 'random')).toBe(true))

    await user.click(screen.getByRole('button', { name: '随机' }))
    await waitFor(() => {
      const randomWrites = mockedSave.mock.calls.filter((c) => Array.isArray(c[0].randOrder))
      expect(randomWrites.length).toBe(2)
    })
  })

  it('服务端存的是随机模式就直接进随机（序列仍指向题库里的题）', async () => {
    mockedProgress.mockResolvedValue(
      progress({ mode: 'random', randOrder: [3, 1, 4, 2], posRandom: 1, posOrder: 0 }),
    )
    renderPage()

    expect(await screen.findByText('第 2 / 4 题')).toBeInTheDocument()
    expect(screen.getByText('问题 1？')).toBeInTheDocument()
  })
})

describe('Recite · 自动阅读', () => {
  async function renderWithCard() {
    renderPage()
    await screen.findByText('问题 1？')
    // 渲染完成后再切假定时器：waitFor 依赖真定时器，先切会卡住
    vi.useFakeTimers()
    return screen.getByRole('switch', { name: /自动阅读/ })
  }

  it('支持朗读时显示「自动阅读」开关，默认关着、也不出声', async () => {
    renderPage()
    await screen.findByText('问题 1？')

    const sw = screen.getByRole('switch', { name: /自动阅读/ })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(spoken).toEqual([])
  })

  it('浏览器不支持朗读就干脆不显示这个开关', async () => {
    vi.stubGlobal('speechSynthesis', undefined)
    renderPage()
    await screen.findByText('问题 1？')

    expect(screen.queryByRole('switch', { name: /自动阅读/ })).not.toBeInTheDocument()
  })

  it('打开开关：立刻念题目，停一下再念答案', async () => {
    const sw = await renderWithCard()
    fireEvent.click(sw)

    expect(spoken).toEqual(['问题 1？'])
    // 题目念完，才开始计那 3 秒的停顿
    pendingUtterance?.onend?.()
    vi.advanceTimersByTime(PAUSE_BEFORE_ANSWER_MS - 1)
    expect(spoken).toEqual(['问题 1？'])
    vi.advanceTimersByTime(1)
    expect(spoken).toEqual(['问题 1？', '答案 1'])
  })

  it('关掉开关就停下，不再往下念', async () => {
    const sw = await renderWithCard()
    fireEvent.click(sw)
    fireEvent.click(sw)

    expect(cancels).toBeGreaterThan(0)
    const stopped = spoken.length
    vi.advanceTimersByTime(PAUSE_BEFORE_ANSWER_MS * 2)
    expect(spoken).toHaveLength(stopped)
  })

  it('开着开关翻页：自动念下一题，不用再点', async () => {
    const sw = await renderWithCard()
    fireEvent.click(sw)
    expect(spoken).toEqual(['问题 1？'])

    fireEvent.click(screen.getByRole('button', { name: '下一题' }))

    expect(spoken).toContain('问题 2？')
  })

  it('开关状态记在本机', async () => {
    const sw = await renderWithCard()
    fireEvent.click(sw)
    expect(localStorage.getItem('recite.autoRead')).toBe('1')
  })

  it('服务端音频拉到了就优先用它 —— 音质更好，而且是真音频，锁屏也能听', async () => {
    const fetchMock = fakeFetch(true)
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    await screen.findByText('问题 1？')
    // 预取是后台做的：等题目那段真正「热」了再点开关
    await waitFor(() => expect(isWarm(1, 'q')).toBe(true))

    fireEvent.click(screen.getByRole('switch', { name: /自动阅读/ }))

    // 没走内置朗读，说明用的是服务端音频
    expect(spoken).toEqual([])
  })

  it('服务端音频拉不到就退回内置朗读 —— 不能没声音', async () => {
    renderPage()
    await screen.findByText('问题 1？')

    fireEvent.click(screen.getByRole('switch', { name: /自动阅读/ }))

    expect(spoken).toEqual(['问题 1？'])
  })

  it('「连播」开关只在自动阅读打开后才出现', async () => {
    renderPage()
    await screen.findByText('问题 1？')

    expect(screen.queryByRole('switch', { name: /连播/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: /自动阅读/ }))
    expect(screen.getByRole('switch', { name: /连播/ })).toBeInTheDocument()
  })

  it('打开连播：一整张卡念完自动翻到下一题，不用一直点', async () => {
    renderPage()
    await screen.findByText('问题 1？')
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('switch', { name: /自动阅读/ }))
    fireEvent.click(screen.getByRole('switch', { name: /连播/ }))
    expect(spoken).toEqual(['问题 1？'])

    // 题目念完
    act(() => {
      pendingUtterance?.onend?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAUSE_BEFORE_ANSWER_MS)
    })
    expect(spoken).toEqual(['问题 1？', '答案 1'])

    // 答案也念完 → 整张卡结束 → 自动翻页
    act(() => {
      pendingUtterance?.onend?.()
    })

    expect(screen.getByText('第 2 / 4 题')).toBeInTheDocument()
    expect(spoken).toContain('问题 2？')
  })

  it('没开连播就不会自己翻页', async () => {
    renderPage()
    await screen.findByText('问题 1？')
    vi.useFakeTimers()

    fireEvent.click(screen.getByRole('switch', { name: /自动阅读/ }))
    act(() => {
      pendingUtterance?.onend?.()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PAUSE_BEFORE_ANSWER_MS)
    })
    act(() => {
      pendingUtterance?.onend?.()
    })

    expect(screen.getByText('第 1 / 4 题')).toBeInTheDocument()
  })

  it('开关是记住的：刷新后不自己开口，等用户碰一下屏幕才念（iOS 手势解锁）', async () => {
    localStorage.setItem('recite.autoRead', '1')
    renderPage()
    await screen.findByText('问题 1？')

    // 刷新进来的第一声不在用户手势里，念了也不会响，所以干脆不念
    expect(spoken).toEqual([])

    fireEvent.pointerDown(document.body)
    expect(spoken).toEqual(['问题 1？'])
  })
})
