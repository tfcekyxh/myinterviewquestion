import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Review from './Review'
import { fetchFullBank, fetchProgress, saveReview, fetchKeyPoints, saveKeyPoints, regenerateKeyPoints, type Question } from '../lib/api'
import { createRecorder, isRecorderSupported, type RecorderState, type Recording } from '../lib/recorder'
import { clipFile, saveFile, ShareCancelled } from '../lib/clipExport'

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

// ShareCancelled 必须留真的 —— Review 里用 instanceof 判断「用户取消」，
// 换成假 class 会让那份眼皮底下的容错失去意义
vi.mock('../lib/clipExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/clipExport')>()
  return { ...actual, saveFile: vi.fn(), clipFile: vi.fn() }
})

vi.mock('../lib/api', () => ({
  fetchFullBank: vi.fn(),
  fetchProgress: vi.fn(),
  saveReview: vi.fn(),
  fetchKeyPoints: vi.fn(),
  saveKeyPoints: vi.fn(),
  regenerateKeyPoints: vi.fn(),
}))

const mockedBank = vi.mocked(fetchFullBank)
const mockedProgress = vi.mocked(fetchProgress)
const mockedSaveReview = vi.mocked(saveReview)
const mockedFetchKeyPoints = vi.mocked(fetchKeyPoints)
const mockedSaveKeyPoints = vi.mocked(saveKeyPoints)
const mockedRegenerate = vi.mocked(regenerateKeyPoints)
const mockedCreate = vi.mocked(createRecorder)
const mockedSupported = vi.mocked(isRecorderSupported)
const mockedSaveFile = vi.mocked(saveFile)
const mockedClipFile = vi.mocked(clipFile)

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
  mockedFetchKeyPoints.mockReset()
  mockedSaveKeyPoints.mockReset()
  mockedRegenerate.mockReset()
  mockedBank.mockResolvedValue({ total: 3, source: '题库.pdf', importedAt: 1, questions: QUESTIONS })
  mockedProgress.mockResolvedValue(BASE_PROGRESS)
  mockedSaveReview.mockResolvedValue(undefined)
  // 默认没有重点（首题自动生成在真实环境才发生），让面板安静不渲染要点
  mockedFetchKeyPoints.mockResolvedValue(null as never)
  mockedSaveFile.mockReset()
  mockedSaveFile.mockResolvedValue('shared')
  mockedClipFile.mockReset()
  mockedClipFile.mockImplementation(() => new File(['x'], 'a.m4a', { type: 'audio/mp4' }))
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

describe('Review · 保存这段录音', () => {
  /** 走一遍「按住 → 说完了 → 对照答案」 */
  async function recordIntoCompare() {
    await screen.findByText(QUESTIONS[0].question)
    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    fireEvent.click(screen.getByRole('button', { name: '说完了' }))
    await screen.findByText('参考答案')
  }

  it('待录 / 录音阶段不出现保存入口（对照答案前，页面越干净越好）', async () => {
    renderPage()
    await screen.findByText(QUESTIONS[0].question)
    expect(screen.queryByRole('button', { name: '保存这段录音' })).not.toBeInTheDocument()

    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    expect(screen.queryByRole('button', { name: '保存这段录音' })).not.toBeInTheDocument()
  })

  it('对照答案后可以把这段交给系统保存，文件名取当前题号', async () => {
    renderPage()
    await recordIntoCompare()

    fireEvent.click(screen.getByRole('button', { name: '保存这段录音' }))

    await waitFor(() => expect(mockedSaveFile).toHaveBeenCalledOnce())
    expect(mockedClipFile).toHaveBeenCalledWith(1, expect.anything(), expect.any(Number))
    expect(await screen.findByRole('status')).toHaveTextContent('文件')
  })

  it('用户在系统面板里取消 → 不作声', async () => {
    mockedSaveFile.mockRejectedValue(new ShareCancelled())
    renderPage()
    await recordIntoCompare()

    fireEvent.click(screen.getByRole('button', { name: '保存这段录音' }))

    await waitFor(() => expect(mockedSaveFile).toHaveBeenCalledOnce())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('保存失败给提示，但已展开的答案不受影响', async () => {
    mockedSaveFile.mockRejectedValue(new Error('系统分享不可用'))
    renderPage()
    await recordIntoCompare()

    fireEvent.click(screen.getByRole('button', { name: '保存这段录音' }))

    expect(await screen.findByRole('status')).toHaveTextContent('保存失败')
    expect(screen.getByText(QUESTIONS[0].answer)).toBeInTheDocument()
  })
})

describe('Review · 对照答案时的回答重点', () => {
  it('对照前不出现；进了对照答案才把 AI 要点亮出来', async () => {
    mockedFetchKeyPoints.mockResolvedValue({
      seq: 1,
      points: ['先说定义', '再给例子', '最后对比'],
      source: 'ai',
      updatedAt: 1,
    })
    renderPage()
    await screen.findByText(QUESTIONS[0].question)

    // 录之前（ready 阶段）不该有任何「回答重点」入口
    expect(screen.queryByText('回答重点')).not.toBeInTheDocument()

    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    fireEvent.click(screen.getByRole('button', { name: '说完了' }))
    await screen.findByText('参考答案')

    // 对照答案才出现（等要点真正加载出来，防抖 600ms）
    expect(await screen.findByText('先说定义', undefined, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByText('回答重点')).toBeInTheDocument()
    expect(screen.getByText('AI 生成')).toBeInTheDocument()
    expect(screen.getByText('再给例子')).toBeInTheDocument()
    expect(screen.getByText('最后对比')).toBeInTheDocument()
    expect(screen.getByText('再给例子')).toBeInTheDocument()
    expect(screen.getByText('最后对比')).toBeInTheDocument()
  })

  it('可以编辑重点：改成自己的话后保存，调用 saveKeyPoints 并标记「我改过」', async () => {
    mockedFetchKeyPoints.mockResolvedValue({
      seq: 1,
      points: ['先说定义', '再给例子'],
      source: 'ai',
      updatedAt: 1,
    })
    mockedSaveKeyPoints.mockResolvedValue({
      seq: 1,
      points: ['先说定义', '加上边界情况'],
      source: 'user',
      updatedAt: 2,
    })
    renderPage()
    await screen.findByText(QUESTIONS[0].question)
    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    fireEvent.click(screen.getByRole('button', { name: '说完了' }))
    await screen.findByText('参考答案')
    await screen.findByText('先说定义', undefined, { timeout: 3000 })

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const ta = await screen.findByRole('textbox')
    fireEvent.change(ta, { target: { value: '先说定义\n加上边界情况' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(mockedSaveKeyPoints).toHaveBeenCalledWith(1, ['先说定义', '加上边界情况']),
    )
    expect(await screen.findByText('我改过')).toBeInTheDocument()
    expect(screen.getByText('加上边界情况')).toBeInTheDocument()
  })

  it('可以「重新生成」让 AI 重来', async () => {
    mockedFetchKeyPoints.mockResolvedValue({
      seq: 1,
      points: ['旧的要点一', '旧的要点二'],
      source: 'ai',
      updatedAt: 1,
    })
    mockedRegenerate.mockResolvedValue({
      seq: 1,
      points: ['新的要点一', '新的要点二', '新的要点三'],
      source: 'ai',
      updatedAt: 2,
    })
    renderPage()
    await screen.findByText(QUESTIONS[0].question)
    fireEvent.pointerDown(mic())
    await screen.findByText('录音中')
    fireEvent.click(screen.getByRole('button', { name: '说完了' }))
    await screen.findByText('参考答案')
    await screen.findByText('旧的要点一', undefined, { timeout: 3000 })

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }))
    await waitFor(() => expect(mockedRegenerate).toHaveBeenCalledWith(1))
    expect(await screen.findByText('新的要点一')).toBeInTheDocument()
    expect(screen.queryByText('旧的要点一')).not.toBeInTheDocument()
  })
})
