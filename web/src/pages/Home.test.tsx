import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Home from './Home'
import { fetchBank } from '../lib/api'

vi.mock('../lib/api', () => ({ fetchBank: vi.fn(), logout: vi.fn() }))

const mockedBank = vi.mocked(fetchBank)

const user = { userId: 1, account: 'admin' }

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

    expect(await screen.findByText('共 200 题')).toBeInTheDocument()
    expect(screen.getByText(/Java 热门面试题 200 道\.pdf · 200 题/)).toBeInTheDocument()
    expect(screen.queryByText('还没有题库，点这里导入 PDF')).not.toBeInTheDocument()
  })

  it('接口失败：显示错误与重试，而不是一片空白', async () => {
    mockedBank.mockRejectedValue(new Error('连不上服务器'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('连不上服务器')
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })
})
