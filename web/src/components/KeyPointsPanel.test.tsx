import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KeyPointsPanel, { type KeyPointError } from './KeyPointsPanel'
import type { KeyPoints } from '../lib/api'

function renderPanel(over: Partial<Parameters<typeof KeyPointsPanel>[0]> = {}) {
  const onSave = vi.fn()
  const onRegenerate = vi.fn()
  const onRetry = vi.fn()
  const props = {
    seq: 1,
    data: null,
    loading: false,
    error: null as KeyPointError,
    regenerating: false,
    onSave,
    onRegenerate,
    onRetry,
    ...over,
  }
  render(<KeyPointsPanel {...props} />)
  return { onSave, onRegenerate, onRetry }
}

const AI: KeyPoints = { seq: 1, points: ['先说定义', '再讲场景', '最后给方案'], source: 'ai', updatedAt: 1 }

describe('KeyPointsPanel', () => {
  it('展示 AI 生成的要点，并带来源标记', () => {
    renderPanel({ data: AI })
    expect(screen.getByText('回答重点')).toBeInTheDocument()
    expect(screen.getByText('AI 生成')).toBeInTheDocument()
    expect(screen.getByText('先说定义')).toBeInTheDocument()
    expect(screen.getByText('最后给方案')).toBeInTheDocument()
  })

  it('用户改过的要点显示「我改过」标记', () => {
    renderPanel({ data: { ...AI, source: 'user' } })
    expect(screen.getByText('我改过')).toBeInTheDocument()
  })

  it('生成中显示占位提示', () => {
    renderPanel({ loading: true })
    expect(screen.getByText('AI 正在总结重点…')).toBeInTheDocument()
  })

  it('服务端未配密钥：静默提示，不挡背诵', () => {
    renderPanel({ error: 'not-configured' })
    expect(screen.getByText(/未启用/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '重试' })).not.toBeInTheDocument()
  })

  it('生成失败：行内报错并提供重试', async () => {
    const { onRetry } = renderPanel({ error: 'failed' })
    const retry = screen.getByRole('button', { name: '重试' })
    await userEvent.click(retry)
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('编辑：把要点变成可改的文本，保存时回调去换行后的行', async () => {
    const user = userEvent.setup()
    const { onSave } = renderPanel({ data: AI })

    await user.click(screen.getByRole('button', { name: '编辑' }))

    const ta = screen.getByPlaceholderText('每条重点一行') as HTMLTextAreaElement
    expect(ta.value).toBe('先说定义\n再讲场景\n最后给方案')

    // 删掉一行、加一行
    await user.clear(ta)
    await user.type(ta, '先说定义{enter}加上边界情况')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(onSave).toHaveBeenCalledWith(['先说定义', '加上边界情况'])
  })

  it('重新生成按钮触发 onRegenerate', async () => {
    const user = userEvent.setup()
    const { onRegenerate } = renderPanel({ data: AI })
    await user.click(screen.getByRole('button', { name: '重新生成' }))
    expect(onRegenerate).toHaveBeenCalledOnce()
  })
})
