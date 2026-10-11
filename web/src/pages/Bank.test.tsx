import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import Bank from './Bank'
import { fetchFullBank, saveQuestions } from '../lib/api'

vi.mock('../lib/api', () => ({ fetchFullBank: vi.fn(), saveQuestions: vi.fn() }))

const mockedFetch = vi.mocked(fetchFullBank)
const mockedSave = vi.mocked(saveQuestions)

// jsdom 没有 createObjectURL / revokeObjectURL
beforeEach(() => {
  mockedFetch.mockReset()
  mockedSave.mockReset()
  Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:fake'),
    revokeObjectURL: vi.fn(),
  })
})

function renderPage() {
  return render(
    <MemoryRouter>
      <Bank />
    </MemoryRouter>,
  )
}

function jsonFile(content: string, name = '题库.json') {
  return new File([content], name, { type: 'application/json' })
}

describe('Bank（导出 / 导入 JSON 兜底）', () => {
  it('导出：把题库写成 JSON 文件', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    mockedFetch.mockResolvedValue({
      total: 2,
      source: '面试题库.pdf',
      importedAt: 1,
      questions: [
        { seq: 1, question: 'Q1', answer: 'A1' },
        { seq: 2, question: 'Q2', answer: 'A2' },
      ],
    })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '导出题库 JSON' }))

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())
    expect(click).toHaveBeenCalled()
    expect(await screen.findByText('已导出 2 题')).toBeInTheDocument()
    click.mockRestore()
  })

  it('题库为空时导出要给出提示，而不是导出一个空文件', async () => {
    mockedFetch.mockResolvedValue({ total: 0, source: null, importedAt: null, questions: [] })
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: '导出题库 JSON' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('题库是空的')
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('导入 JSON：整批提交', async () => {
    mockedSave.mockResolvedValue({ ok: true, total: 2 })
    renderPage()

    fireEvent.change(screen.getByLabelText('选择 JSON 文件'), {
      target: {
        files: [
          jsonFile(
            JSON.stringify({ source: '备份.pdf', questions: [{ question: 'Q1', answer: 'A1' }, { question: 'Q2', answer: 'A2' }] }),
          ),
        ],
      },
    })

    await waitFor(() => expect(mockedSave).toHaveBeenCalledOnce())
    expect(mockedSave.mock.calls[0][0]).toBe('备份.pdf')
    expect(mockedSave.mock.calls[0][1]).toEqual([
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ])
  })

  it('不是 JSON / 格式不对：给出明确提示，不动题库', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('选择 JSON 文件'), {
      target: { files: [jsonFile('这不是 json')] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('这不是有效的 JSON 文件')
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('文件里有空题干：拒绝导入', async () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('选择 JSON 文件'), {
      target: { files: [jsonFile(JSON.stringify({ questions: [{ question: '', answer: 'A' }] }))] },
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('存在空的题干')
    expect(mockedSave).not.toHaveBeenCalled()
  })

  it('有「重新导入 PDF」的入口', () => {
    renderPage()
    expect(screen.getByRole('button', { name: '重新导入 PDF' })).toBeInTheDocument()
  })
})
