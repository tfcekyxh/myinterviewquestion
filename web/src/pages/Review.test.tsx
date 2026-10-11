import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Review from './Review'
import { fetchFullBank, fetchProgress, saveReview, type Question } from '../lib/api'
import { createRecorder, isRecorderSupported, type RecorderState, type Recording } from '../lib/recorder'

// ── 假录音器 ────────────────────────────────────────────────────
// jsdom 里没有 MediaRecorder，所以组件测试一律换桩。真录音只在 e2e / 真机上跑。
const CLIP: Recording = {
  blob: new Blob(['fake-audio'], { type: 'audio/mp4' }),
  mimeType: 'audio/mp4',
  durationMs: 4200,
}

type FakeRecorder = {
  state: RecorderState
  start: Mock
  stop: Mock
  cancel: Mock
  setLevelHandler: Mock
  dispose: Mock
}

let fake: FakeRecorder

function makeFake(): FakeRecorder {
  const r: FakeRecorder = {
    state: 'idle',
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    setLevelHandler: vi.fn(),
    dispose: vi.fn(),
  }
  r.start.mockImplementation(async () => {
    r.state = 'recording'
  })
  r.stop.mockImplementation(async () => {
    r.state = 'idle'
    return CLIP
  })
  return r
}

vi.mock('../lib/recorder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/recorder')>()
  return { ...actual, createRecorder: vi.fn(), isRecorderSupported: vi.fn(() => true) }
})

vi.mock('../lib/audioStore', () => ({ saveClip: vi.fn(async () => 'clip-key') }))

vi.mock('../lib/api', () => ({
  fetchFullBank: vi.fn(),
  fetchProgress: vi.fn(),
  saveReview: vi.fn(),
}))

const mockedBank = vi.mocked(fetchFullBank)
const mockedProgress = vi.mocked(fetchProgress)
const mockedSaveReview = vi.mocked(saveReview)
const mockedCreate = vi.mocked(createRecorder)
const mockedSupported = vi.mocked(isRecorderSupported)

// 答案刻意写成和界面文案完全不同的句子，避免误判
const QUESTIONS: Question[] = [
  { seq: 1, question: 'Java 中有哪些集合类？', answer: '一号答案：List、Set、Map 三大家族' },
  { seq: 2, question: 'HashMap 的底层结构是什么？', answer: '二号答案：数组加链表加红黑树' },
  { seq: 3, question: '什么是双亲委派模型？', answer: '三号答案：类加载器逐级向上委托' },
]
const ALL_ANSWERS = QUESTIONS.map((q) => q.answer)

const BASE_PROGRESS = {
  mode: 'order' as const,
  posOrder: 0,
  posRandom: 0,
  randOrder: [] as number[],
  roundStart: null,
  lastRound: null,
  total: 3,
  updatedAt: null,
}

function renderPage(entry = '/review/run?scope=all&mode=order') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Review />
    </MemoryRouter>,
  )
}

/** 整页可见文本。⚠️ 必须先剔掉 script/style/template，否则内联脚本源码会被算进来 */
function pageText(): string {
  const clone = document.body.cloneNode(true) as HTMLElement
  clone.querySelectorAll('script,style,template').forEach((n) => n.remove())
  return clone.textContent ?? ''
}

// 录音中可访问名会变成「结束录音」，所以用正则同时匹配两种状态
const mic = () => screen.getByRole('button', { name: /按住录音|结束录音/ })

beforeEach(() => {
  fake = makeFake()
  mockedCreate.mockReturnValue(fake)
  mockedSupported.mockReturnValue(true)
  mockedBank.mockReset()
  mockedProgress.mockReset()
  mockedSaveReview.mockReset()
  mockedBank.mockResolvedValue({ total: 3, source: '题库.pdf', importedAt: 1, questions: QUESTIONS })
  mockedProgress.mockResolvedValue(BASE_PROGRESS)
  mockedSaveReview.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Review · 答案绝不能在对照前出现（本阶段最重要的一条）', () => {
  it('待录阶段：题干在，答案区只有「答案已隐藏」，全文找不到任何答案', async () => {
    renderPage()

    expect(await screen.findByText(QUESTIONS[0].question)).toBeInTheDocument()
    expect(screen.getByText('答案已隐藏')).toBeInTheDocument()

    const text = pageText()
    for (const a of ALL_ANSWERS) expect(text).not.toContain(a)
    // 也不存在任何可点的「显示答案」入口
    expect(screen.queryByRole('button', { name: /显示答案|查看答案|参考答案/ })).not.toBeInTheDocument()
  })

  it('录音过程中照样看不到答案', async () => {
    renderPage()
    await screen.findByText(QUESTIONS[0].question)

    fireEvent.pointerDown(mic())
    expect(await screen.findByText('录音中')).toBeInTheDocument()

    for (const a of ALL_ANSWERS) expect(pageText()).not.toContain(a)
  })

  it('录完音进了「对照答案」，答案才出现，并且能回放', async () => {
    renderPage()
    await screen.findByText(QUESTIONS[0].question)

    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    fireEvent.click(screen.getByRole('button', { name: '说完了' }))

    expect(await screen.findByText('参考答案')).toBeInTheDocument()
    expect(screen.getByText(QUESTIONS[0].answer)).toBeInTheDocument()
    expect(screen.getByText('回放我刚才说的')).toBeInTheDocument()

    // 回放：能播、能暂停。
    // 先等按钮真的可用再点 —— 点一个 disabled 按钮什么都不会发生，
    // 而默认 1s 的 findBy 超时在负载高的时候容易误判
    const play = screen.getByRole('button', { name: '播放回放' })
    await waitFor(() => expect(play).toBeEnabled())
    fireEvent.click(play)
    expect(await screen.findByRole('button', { name: '暂停回放' }, { timeout: 3000 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '暂停回放' }))
    expect(await screen.findByRole('button', { name: '播放回放' }, { timeout: 3000 })).toBeInTheDocument()
  })

  it('切到下一题，答案重新藏回去', async () => {
    renderPage()
    await screen.findByText(QUESTIONS[0].question)

    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    fireEvent.click(screen.getByRole('button', { name: '说完了' }))
    await screen.findByText('参考答案')

    fireEvent.click(screen.getByRole('button', { name: '下一题' }))

    expect(await screen.findByText(QUESTIONS[1].question)).toBeInTheDocument()
    expect(screen.queryByText('参考答案')).not.toBeInTheDocument()
    expect(screen.getByText('答案已隐藏')).toBeInTheDocument()
    for (const a of ALL_ANSWERS) expect(pageText()).not.toContain(a)
  })
})

describe('Review · 录音手势', () => {
  it('按住不放再松手 = 结束录音', async () => {
    const t0 = 1_700_000_000_000
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0)

    renderPage()
    await screen.findByText(QUESTIONS[0].question)

    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')

    now.mockReturnValue(t0 + 1500) // 按住 1.5 秒
    fireEvent.pointerUp(mic())

    expect(await screen.findByText('参考答案')).toBeInTheDocument()
  })

  it('只是点一下（松手很快）= 继续录，不结束', async () => {
    const t0 = 1_700_000_000_000
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0)

    renderPage()
    await screen.findByText(QUESTIONS[0].question)

    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    now.mockReturnValue(t0 + 120) // 120ms 就松手了
    fireEvent.pointerUp(mic())

    expect(screen.getByText('录音中')).toBeInTheDocument()
    expect(screen.queryByText('参考答案')).not.toBeInTheDocument()
  })

  it('记了一条复习记录：哪一题、讲了多久', async () => {
    renderPage()
    await screen.findByText(QUESTIONS[0].question)

    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    fireEvent.click(screen.getByRole('button', { name: '说完了' }))
    await screen.findByText('参考答案')

    await waitFor(() =>
      expect(mockedSaveReview).toHaveBeenCalledWith({
        seq: 1,
        durationMs: CLIP.durationMs,
        clipKey: 'clip-key',
      }),
    )
  })
})

describe('Review · 失败路径不能卡死', () => {
  it('麦克风被拒绝：给明确提示，且不要停在「录音中」', async () => {
    fake.start.mockRejectedValue(new Error('麦克风权限被拒绝。请在 Safari 的「网站设置」里允许麦克风后重试'))
    renderPage()
    await screen.findByText(QUESTIONS[0].question)

    fireEvent.pointerDown(mic())

    expect(await screen.findByRole('alert')).toHaveTextContent('麦克风权限被拒绝')
    expect(screen.queryByText('录音中')).not.toBeInTheDocument()
    expect(screen.getByText('按住说话，讲完松手')).toBeInTheDocument()
  })

  it('什么都没录到：提示重试，并且不泄露答案', async () => {
    fake.stop.mockResolvedValue(null)
    renderPage()
    await screen.findByText(QUESTIONS[0].question)

    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    fireEvent.click(screen.getByRole('button', { name: '说完了' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('没录到声音')
    expect(screen.queryByText('参考答案')).not.toBeInTheDocument()
    expect(pageText()).not.toContain(QUESTIONS[0].answer)
  })

  it('浏览器不支持录音：按钮禁用并说明原因', async () => {
    mockedSupported.mockReturnValue(false)
    renderPage()
    await screen.findByText(QUESTIONS[0].question)

    expect(screen.getByText('这个浏览器不支持录音，请用 Safari 打开')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '按住录音' })).toBeDisabled()
  })

  it('没有题库：给提示 + 回上一页，不白屏', async () => {
    mockedBank.mockResolvedValue({ total: 0, source: null, importedAt: null, questions: [] })
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('还没有题库')
    expect(screen.getByRole('button', { name: '重新选范围' })).toBeInTheDocument()
  })
})

describe('Review · 边界', () => {
  it('停在第一题时「上一题」禁用', async () => {
    renderPage()
    await screen.findByText(QUESTIONS[0].question)
    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    fireEvent.click(screen.getByRole('button', { name: '说完了' }))
    await screen.findByText('参考答案')

    expect(screen.getByRole('button', { name: '上一题' })).toBeDisabled()
  })

  it('停在最后一题时「下一题」禁用', async () => {
    renderPage('/review/run?scope=all&mode=order&i=2')
    expect(await screen.findByText(QUESTIONS[2].question)).toBeInTheDocument()

    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    fireEvent.click(screen.getByRole('button', { name: '说完了' }))
    await screen.findByText('参考答案')

    expect(screen.getByRole('button', { name: '下一题' })).toBeDisabled()
  })

  it('范围选「刚背完的一轮」时只走那一批题', async () => {
    mockedProgress.mockResolvedValue({
      ...BASE_PROGRESS,
      roundStart: null,
      lastRound: { seqs: [2, 3], count: 2 },
    })
    renderPage('/review/run?scope=round&mode=order')

    expect(await screen.findByText(QUESTIONS[1].question)).toBeInTheDocument()
    expect(screen.getByText('第 1 / 2 题')).toBeInTheDocument()
  })
})
