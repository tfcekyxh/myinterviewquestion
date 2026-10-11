import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import Import from './Import'
import { saveQuestions } from '../lib/api'
import { PdfError, extractItems } from '../lib/pdf/extract'
import type { RawItem } from '../lib/pdf/parse'

vi.mock('../lib/api', () => ({ saveQuestions: vi.fn() }))
vi.mock('../lib/pdf/extract', () => ({
  extractItems: vi.fn(),
  PdfError: class PdfError extends Error {},
}))

const mockedExtract = vi.mocked(extractItems)
const mockedSave = vi.mocked(saveQuestions)

const TITLE = 9.65
const BODY = 8.25

/** 构造一行：逐字形绘制，x 递增 */
function line(page: number, y: number, text: string, size: number): RawItem[] {
  return Array.from(text, (str, i) => ({ page, str, size, x: 56 + i * 8, y, width: 8 }))
}

function bank(n: number): RawItem[] {
  const items: RawItem[] = []
  for (let i = 0; i < n; i++) {
    const y = 100 - i * 40
    items.push(...line(1, y, `第 ${i + 1} 题是什么？`, TITLE))
    items.push(...line(1, y - 10, `第 ${i + 1} 题的答案第一句。`, BODY))
    items.push(...line(1, y - 20, `第 ${i + 1} 题的答案第二句。`, BODY))
    items.push(...line(1, y - 30, `第 ${i + 1} 题的答案第三句。`, BODY))
  }
  return items
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Import />
    </MemoryRouter>,
  )
}

function pickFile(name = '面试题库.pdf') {
  const file = new File(['x'], name, { type: 'application/pdf' })
  fireEvent.change(screen.getByLabelText('选择 PDF 文件'), { target: { files: [file] } })
  return file
}

describe('Import', () => {
  beforeEach(() => {
    mockedExtract.mockReset()
    mockedSave.mockReset()
  })

  it('未选文件时「开始解析」不可点', () => {
    renderPage()
    expect(screen.getByRole('button', { name: '开始解析' })).toBeDisabled()
  })

  it('选中文件后显示文件名，按钮激活', () => {
    renderPage()
    pickFile()
    expect(screen.getByText('面试题库.pdf')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始解析' })).toBeEnabled()
  })

  it('解析成功：显示题目数、有答案数、待确认数与前 3 题预览', async () => {
    mockedExtract.mockResolvedValue(bank(5))
    renderPage()
    pickFile()
    await userEvent.click(screen.getByRole('button', { name: '开始解析' }))

    expect(await screen.findByText('前 3 题预览')).toBeInTheDocument()
    // 5 题 / 5 题有答案 / 0 处待确认
    const values = screen.getAllByText(/^(5|0)$/).map((n) => n.textContent)
    expect(values).toContain('5')
    expect(screen.getByText('第 1 题是什么？')).toBeInTheDocument()
    expect(screen.getByText('第 2 题是什么？')).toBeInTheDocument()
    expect(screen.getByText('第 3 题是什么？')).toBeInTheDocument()
    // 只预览前 3 题
    expect(screen.queryByText('第 4 题是什么？')).not.toBeInTheDocument()
  })

  it('抽不出题目（扫描件）：给出明确提示，不进结果页', async () => {
    mockedExtract.mockResolvedValue([])
    renderPage()
    pickFile()
    await userEvent.click(screen.getByRole('button', { name: '开始解析' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('可能是扫描件')
    expect(screen.queryByText('前 3 题预览')).not.toBeInTheDocument()
  })

  it('PDF 损坏 / 加密：显示可读的错误，不静默失败', async () => {
    mockedExtract.mockRejectedValue(new PdfError('这个 PDF 有密码保护，请先解除密码再导入'))
    renderPage()
    pickFile()
    await userEvent.click(screen.getByRole('button', { name: '开始解析' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('有密码保护')
  })

  it('确认入库：把解析结果整批提交', async () => {
    mockedExtract.mockResolvedValue(bank(4))
    mockedSave.mockResolvedValue({ ok: true, total: 4 })
    renderPage()
    pickFile()
    await userEvent.click(screen.getByRole('button', { name: '开始解析' }))
    await screen.findByText('前 3 题预览')

    await userEvent.click(screen.getByRole('button', { name: '确认入库' }))

    await waitFor(() => expect(mockedSave).toHaveBeenCalledOnce())
    const [source, questions] = mockedSave.mock.calls[0]
    expect(source).toBe('面试题库.pdf')
    expect(questions).toHaveLength(4)
    expect(questions[0].question).toBe('第 1 题是什么？')
  })

  it('入库失败：回到结果页并提示，不丢掉已解析的数据', async () => {
    mockedExtract.mockResolvedValue(bank(2))
    mockedSave.mockRejectedValue(new Error('入库失败，题库未被修改'))
    renderPage()
    pickFile()
    await userEvent.click(screen.getByRole('button', { name: '开始解析' }))
    await screen.findByText('前 3 题预览')

    await userEvent.click(screen.getByRole('button', { name: '确认入库' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('入库失败')
    expect(screen.getByText('前 3 题预览')).toBeInTheDocument()
  })
})
