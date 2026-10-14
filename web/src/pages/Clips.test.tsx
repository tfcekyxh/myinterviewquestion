import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Clips from './Clips'
import { fetchFullBank, type Question } from '../lib/api'
import { deleteClip, listClips, type StoredClip } from '../lib/audioStore'
import { clipFile, saveFile } from '../lib/clipExport'

vi.mock('../lib/api', () => ({ fetchFullBank: vi.fn() }))

// seqOfClip 是纯函数，留真的 —— 正好顺带验证「老录音靠 key 反解题号」这条路。
// 只有真碰 IndexedDB 的换成桩。
vi.mock('../lib/audioStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/audioStore')>()
  return { ...actual, listClips: vi.fn(), deleteClip: vi.fn() }
})

vi.mock('../lib/clipExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/clipExport')>()
  return { ...actual, saveFile: vi.fn(), clipFile: vi.fn() }
})

const mockedList = vi.mocked(listClips)
const mockedDelete = vi.mocked(deleteClip)
const mockedBank = vi.mocked(fetchFullBank)
const mockedSaveFile = vi.mocked(saveFile)
const mockedClipFile = vi.mocked(clipFile)

const QUESTIONS: Question[] = [
  { seq: 3, question: '什么是双亲委派模型？', answer: '类加载器逐级向上委托' },
  { seq: 7, question: 'HashMap 的底层结构是什么？', answer: '数组加链表加红黑树' },
]

const A_BANK = { total: 200, source: '题库.pdf', importedAt: 1, questions: QUESTIONS }

const T0 = new Date(2026, 9, 14, 18, 30).getTime()

/** withSeqField=false 用来模拟线上已有的老录音（那批数据里没有 seq 字段） */
function makeClip(seq: number, at: number, withSeqField = true): StoredClip {
  const base = {
    key: `clip:${seq}:${at}`,
    createdAt: at,
    blob: new Blob(['x'.repeat(2048)], { type: 'audio/mp4' }),
    mimeType: 'audio/mp4',
    durationMs: 42_000,
  }
  return withSeqField ? { ...base, seq } : base
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/clips']}>
      <Clips />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedList.mockResolvedValue([])
  mockedDelete.mockResolvedValue(undefined)
  mockedBank.mockResolvedValue(A_BANK)
  mockedSaveFile.mockResolvedValue('shared')
  mockedClipFile.mockImplementation(
    (seq) => new File(['x'], `第${seq}题.m4a`, { type: 'audio/mp4' }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Clips · 列出本机录音', () => {
  it('没有录音时给空状态 + 去复习的入口', async () => {
    renderPage()
    expect(await screen.findByText(/还没有录音/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '去复习' })).toBeInTheDocument()
  })

  it('有录音时列出题号、题干、时长、体积和总占用', async () => {
    mockedList.mockResolvedValue([makeClip(3, T0)])
    renderPage()

    expect(await screen.findByText('1 段录音')).toBeInTheDocument()
    expect(screen.getByText('3 题', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('什么是双亲委派模型？')).toBeInTheDocument()
    // fixture 是 2048 字节，且时长 00:42
    expect(screen.getByText('00:42')).toBeInTheDocument()
    expect(screen.getByText('2 KB')).toBeInTheDocument()
    expect(screen.getByText(/共 2 KB/)).toBeInTheDocument()
  })

  it('老录音没有 seq 字段也能认出题号（从 key 反解，不用数据迁移）', async () => {
    mockedList.mockResolvedValue([makeClip(7, T0, false)])
    renderPage()

    await screen.findByText('1 段录音')
    expect(screen.getByText('7 题', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('HashMap 的底层结构是什么？')).toBeInTheDocument()
  })

  it('拉不到题库也照样列出录音 —— 录音在本机，不该被服务端故障挡住', async () => {
    mockedBank.mockRejectedValue(new Error('网络不可用'))
    mockedList.mockResolvedValue([makeClip(3, T0)])
    renderPage()

    expect(await screen.findByText('1 段录音')).toBeInTheDocument()
    expect(screen.getByText('3 题', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('什么是双亲委派模型？')).not.toBeInTheDocument()
  })

  it('IndexedDB 读不出来时给整页错误 + 退路', async () => {
    mockedList.mockRejectedValue(new Error('本机存储打不开'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('本机存储打不开')
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument()
  })
})

describe('Clips · 回听', () => {
  it('点回听开始放，再点停止', async () => {
    mockedList.mockResolvedValue([makeClip(3, T0)])
    renderPage()
    await screen.findByText('1 段录音')

    fireEvent.click(screen.getByRole('button', { name: '回听' }))
    expect(await screen.findByRole('button', { name: '停止' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(await screen.findByRole('button', { name: '回听' })).toBeInTheDocument()
  })
})

describe('Clips · 单条导出', () => {
  it('导出的文件名带题号', async () => {
    mockedList.mockResolvedValue([makeClip(3, T0)])
    renderPage()
    await screen.findByText('1 段录音')

    fireEvent.click(screen.getByRole('button', { name: '导出' }))

    await waitFor(() => expect(mockedSaveFile).toHaveBeenCalledOnce())
    expect(mockedClipFile).toHaveBeenCalledWith(3, expect.anything(), T0)
    expect(await screen.findByRole('alert')).toHaveTextContent('文件')
  })

  it('用户在系统面板里取消 → 不做任何提示', async () => {
    const { ShareCancelled } = await import('../lib/clipExport')
    mockedSaveFile.mockRejectedValue(new ShareCancelled())
    mockedList.mockResolvedValue([makeClip(3, T0)])
    renderPage()
    await screen.findByText('1 段录音')

    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    await waitFor(() => expect(mockedSaveFile).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('导出真失败才提示', async () => {
    mockedSaveFile.mockRejectedValue(new Error('磁盘满了'))
    mockedList.mockResolvedValue([makeClip(3, T0)])
    renderPage()
    await screen.findByText('1 段录音')

    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘满了')
  })
})

describe('Clips · 删除', () => {
  it('要点二次确认才真删', async () => {
    mockedList.mockResolvedValue([makeClip(3, T0)])
    renderPage()
    await screen.findByText('1 段录音')

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(mockedDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '确定删除' }))
    // 用 fixture 的 T0 拼，不要手写时间戳（手写的那个值是 2023 年的，白 debug 一轮）
    await waitFor(() => expect(mockedDelete).toHaveBeenCalledWith(`clip:3:${T0}`))
    expect(await screen.findByText(/还没有录音/)).toBeInTheDocument()
  })
})

describe('Clips · 全部导出', () => {
  it('先说清会弹几次面板，确认后逐条导出', async () => {
    mockedList.mockResolvedValue([makeClip(3, T0), makeClip(7, T0 + 1000)])
    renderPage()
    expect(await screen.findByText('2 段录音')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '导出全部录音' }))

    // iPhone 一次只能存一个文件，必须让用户提前知道要操作几次
    expect(await screen.findByText(/会依次弹出 2 次分享面板/)).toBeInTheDocument()
    expect(mockedSaveFile).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '开始导出' }))

    await waitFor(() => expect(mockedSaveFile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('button', { name: '导出全部录音' })).toBeInTheDocument())
  })

  it('中途在面板里取消 → 停在那一批，不报错', async () => {
    const { ShareCancelled } = await import('../lib/clipExport')
    mockedList.mockResolvedValue([makeClip(3, T0), makeClip(7, T0 + 1000)])
    mockedSaveFile.mockRejectedValueOnce(new ShareCancelled())
    renderPage()
    await screen.findByText('2 段录音')

    fireEvent.click(screen.getByRole('button', { name: '导出全部录音' }))
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('已停止，导出了前 0 段')
    expect(mockedSaveFile).toHaveBeenCalledTimes(1)
  })

  it('导出过程中列表里的操作被锁住（免得一边导出一边删）', async () => {
    mockedList.mockResolvedValue([makeClip(3, T0)])
    let release: (() => void) | undefined
    mockedSaveFile.mockImplementation(
      () => new Promise<'shared'>((resolve) => { release = () => resolve('shared') }),
    )
    renderPage()
    await screen.findByText('1 段录音')

    fireEvent.click(screen.getByRole('button', { name: '导出全部录音' }))
    fireEvent.click(screen.getByRole('button', { name: '开始导出' }))

    expect(await screen.findByRole('status')).toHaveTextContent('正在导出 1 / 1')
    expect(screen.getByRole('button', { name: '导出' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled()

    release!()
    await waitFor(() => expect(screen.getByRole('button', { name: '导出' })).toBeEnabled())
  })
})
