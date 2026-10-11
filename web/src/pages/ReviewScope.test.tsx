import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ReviewScope from './ReviewScope'
import { fetchBank, fetchProgress, type ProgressState } from '../lib/api'

vi.mock('../lib/api', () => ({ fetchBank: vi.fn(), fetchProgress: vi.fn() }))

const mockedBank = vi.mocked(fetchBank)
const mockedProgress = vi.mocked(fetchProgress)

function progress(over: Partial<ProgressState> = {}): ProgressState {
  return {
    mode: 'order',
    posOrder: 0,
    posRandom: 0,
    randOrder: [],
    roundStart: null,
    lastRound: null,
    total: 240,
    updatedAt: null,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/review']}>
      <Routes>
        <Route path="/review" element={<ReviewScope />} />
        <Route path="/review/run" element={<div>复习进行中</div>} />
        <Route path="/" element={<div>首页</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ReviewScope', () => {
  beforeEach(() => {
    mockedBank.mockReset()
    mockedProgress.mockReset()
    mockedBank.mockResolvedValue({ total: 240, source: '题库.pdf', importedAt: 1 })
    mockedProgress.mockResolvedValue(progress())
  })

  it('有背完记录：默认选中「刚背完的这一轮」并显示范围', async () => {
    mockedProgress.mockResolvedValue(progress({ lastRound: { seqs: [129, 130, 131], count: 3 } }))
    renderPage()

    const card = await screen.findByRole('button', { name: /刚背完的这一轮/ })
    expect(card).toBeEnabled()
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('第 129 – 131 题')).toBeInTheDocument()
  })

  it('没有背完记录：那张卡禁用并说明原因，默认退到「整个题库」', async () => {
    renderPage()

    const round = await screen.findByRole('button', { name: /刚背完的这一轮/ })
    expect(round).toBeDisabled()
    expect(screen.getByText('还没有背完的记录')).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /整个题库/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('共 240 题')).toBeInTheDocument()
  })

  it('顺序/随机默认沿用背诵时的模式', async () => {
    mockedProgress.mockResolvedValue(progress({ mode: 'random', randOrder: [1, 2, 3] }))
    renderPage()

    expect(await screen.findByRole('button', { name: '随机' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '顺序' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('没有题库时不能开始复习', async () => {
    mockedBank.mockResolvedValue({ total: 0, source: null, importedAt: null })
    renderPage()

    expect(await screen.findByText('还没有导入题库')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始复习' })).toBeDisabled()
  })

  it('选好以后进复习页，并把范围与模式带在地址上', async () => {
    const user = userEvent.setup()
    mockedProgress.mockResolvedValue(progress({ mode: 'random', lastRound: { seqs: [5, 6], count: 2 } }))
    renderPage()

    // 默认就是「刚背完的这一轮」+ 随机
    await user.click(await screen.findByRole('button', { name: '开始复习' }))

    expect(await screen.findByText('复习进行中')).toBeInTheDocument()
  })
})
