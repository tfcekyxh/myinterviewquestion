import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Recite from './Recite'
import { fetchFullBank, fetchProgress, saveProgress, type ProgressState, type Question } from '../lib/api'

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
  return { mode: 'order', posOrder: 0, posRandom: 0, randOrder: [], total: 4, updatedAt: null, ...over }
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
})

afterEach(() => {
  vi.restoreAllMocks()
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
