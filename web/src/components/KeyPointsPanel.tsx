import { useState } from 'react'
import type { KeyPoints } from '../lib/api'

export type KeyPointError = 'not-configured' | 'failed' | null

interface Props {
  /** 当前题号（面板按题号挂载，切题时整块重置编辑态） */
  seq: number
  /** 已加载的重点；未加载完为 null */
  data: KeyPoints | null
  loading: boolean
  error: KeyPointError
  regenerating: boolean
  onSave: (points: string[]) => void
  onRegenerate: () => void
  onRetry: () => void
}

/**
 * 背诵页的「回答重点」区块。
 * - 有数据：列出要点 + 来源标记 + 编辑 / 重新生成
 * - 首次生成中：占位提示
 * - 服务端未配密钥：静默提示，不挡背诵
 * - 生成失败：行内报错 + 重试
 * 编辑态是本地的，切题时由父级用 key={seq} 强制重挂载。
 */
export default function KeyPointsPanel({
  data,
  loading,
  error,
  regenerating,
  onSave,
  onRegenerate,
  onRetry,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const hasData = !!data && data.points.length > 0

  function startEdit() {
    setDraft((data?.points ?? []).join('\n'))
    setEditing(true)
  }

  function commitEdit() {
    const lines = draft
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    onSave(lines)
    setEditing(false)
  }

  return (
    <div className="card keypoints">
      <div className="keypoints-head">
        <span className="t-title-2">回答重点</span>
        {data?.source === 'ai' && <span className="tag tag-ai">AI 生成</span>}
        {data?.source === 'user' && <span className="tag tag-user">我改过</span>}
        <span style={{ flex: 1 }} />
        {!editing && hasData && (
          <>
            <button type="button" className="link-btn" onClick={startEdit}>
              编辑
            </button>
            <button type="button" className="link-btn" onClick={onRegenerate} disabled={regenerating}>
              {regenerating ? '生成中…' : '重新生成'}
            </button>
          </>
        )}
      </div>

      {loading && !hasData && (
        <div className="t-caption color-text-2" style={{ marginTop: 8 }}>
          AI 正在总结重点…
        </div>
      )}

      {!loading && error === 'not-configured' && (
        <div className="t-caption color-text-3" style={{ marginTop: 8 }}>
          AI 重点未启用（服务端未配置密钥）
        </div>
      )}

      {!loading && error === 'failed' && (
        <div className="inline-error" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>AI 生成失败</span>
          <button type="button" className="link-btn" onClick={onRetry}>
            重试
          </button>
        </div>
      )}

      {editing ? (
        <div style={{ marginTop: 8 }}>
          <textarea
            className="keypoints-edit"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(8, Math.max(3, draft.split('\n').length + 1))}
            placeholder="每条重点一行"
          />
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button type="button" className="btn-secondary" style={{ height: 40 }} onClick={() => setEditing(false)}>
              取消
            </button>
            <button type="button" className="btn-primary" style={{ height: 40 }} onClick={commitEdit}>
              保存
            </button>
          </div>
        </div>
      ) : hasData ? (
        <ul className="keypoints-list">
          {data!.points.map((p, i) => (
            <li key={i} className="t-body color-text-2">
              {p}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
