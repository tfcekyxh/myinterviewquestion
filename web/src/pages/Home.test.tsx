import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'
import { fetchBank, fetchProgress, type ProgressState } from '../lib/api'

vi.mock('../lib/api', () => ({ fetchBank: vi.fn(), fetchProgress: vi.fn(), logout: vi.fn() }))

const mockedBank = vi.mocked(fetchBank)
const mockedProgress = vi.mocked(fetchProgress)

const user = { userId: 1, account: 'admin' }

function progress(over: Partial<ProgressState> = {}): ProgressState {
  return { mode: 'order', posOrder: 0, posRandom: 0, randOrder: [], roundStart: null, lastRound: null, total: 240, updatedAt: null, ...over }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Home user={user} onLogout={vi.fn()} />
    </MemoryRouter>,
  )
}

describe('Home', () => {
  beforeEach(() => {
    mockedBank.mockReset()
    mockedProgress.mockReset()
    mockedProgress.mockResolvedValue(progress())
  })

  it('未导入题库：显示空状态与「导入题库」，不显示题数', async () => {
    mockedBank.mockResolvedValue({ total: 0, source: null, importedAt: null })
    renderPage()

    expect(await screen.findByText('还没有题库，点这里导入 PDF')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入题库' })).toBeInTheDocument()
    expect(screen.queryByText(/^题库：/)).not.toBeInTheDocument()
  })

  it('已导入：显示题库规模与来源', async () => {
    mockedBank.mockResolvedValue({
      total: 200,
      source: 'Java 热门面试题 200 道.pdf',
      importedAt: 1_700_000_000_000,
    })
    renderPage()

    expect(await screen.findByText('题库：Java 热门面试题 200 道.pdf · 200 题')).toBeInTheDocument()
    expect(screen.queryByText('还没有题库，点这里导入 PDF')).not.toBeInTheDocument()
  })

  it('已背 128 题：显示「已背 128 / 240」与「上次背到第 129 题」', async () => {
    mockedBank.mockResolvedValue({ total: 240, source: '题库.pdf', importedAt: 1 })
    mockedProgress.mockResolvedValue(progress({ posOrder: 128 }))
    renderPage()

    expect(await screen.findByText('已背 128 / 240')).toBeInTheDocument()
    expect(screen.getByText('上次背到第 129 题')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '继续背诵' })).toBeInTheDocument()
  })

  it('还没背过：显示「还没开始」，主按钮是「开始背诵」', async () => {
    mockedBank.mockResolvedValue({ total: 240, source: '题库.pdf', importedAt: 1 })
    renderPage()

    expect(await screen.findByText('还没开始，从第 1 题开始')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始背诵' })).toBeInTheDocument()
  })

  it('背完一轮：提示去复习', async () => {
    mockedBank.mockResolvedValue({ total: 240, source: '题库.pdf', importedAt: 1 })
    mockedProgress.mockResolvedValue(progress({ posOrder: 240 }))
    renderPage()

    expect(await screen.findByText('已背 240 / 240')).toBeInTheDocument()
    expect(screen.getByText('这一轮已经背完了，去复习一下？')).toBeInTheDocument()
  })

  it('接口失败：显示错误与重试，而不是一片空白', async () => {
    mockedBank.mockRejectedValue(new Error('连不上服务器'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('连不上服务器')
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})
