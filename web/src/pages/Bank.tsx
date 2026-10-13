import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  downloadBackup,
  fetchFullBank,
  resetProgress,
  restoreBackup,
  saveQuestions,
  type ParsedQuestion,
} from '../lib/api'

/**
 * 题库管理（P2.5）—— 兜底用的「导出 / 导入 JSON」。
 *
 * 为什么必须有：我们不验证「重新发布后 SQLite 文件还在不在」。
 * 有了导出，最坏情况只是「重新发布后导一次 JSON」，而不是「题库没了」。
 */
export default function Bank() {
  const navigate = useNavigate()
  const jsonRef = useRef<HTMLInputElement>(null)
  const dbRef = useRef<HTMLInputElement>(null)

  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState<File | null>(null)

  async function doResetProgress() {
    setBusy('reset')
    setMessage(null)
    try {
      await resetProgress()
      setMessage({ kind: 'ok', text: '背诵进度已重置' })
      setConfirmReset(false)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : '重置失败' })
    } finally {
      setBusy(null)
    }
  }

  async function exportJson() {
    setBusy('export')
    setMessage(null)
    try {
      const bank = await fetchFullBank()
      if (bank.questions.length === 0) {
        setMessage({ kind: 'error', text: '题库是空的，没什么可导出' })
        return
      }
      const payload = {
        version: 1,
        source: bank.source ?? '',
        exportedAt: Date.now(),
        questions: bank.questions.map((q) => ({ question: q.question, answer: q.answer })),
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `题库-${bank.total}题-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      setMessage({ kind: 'ok', text: `已导出 ${bank.total} 题` })
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : '导出失败' })
    } finally {
      setBusy(null)
    }
  }

  /** 导出整库文件（SQLite 源文件）：连进度和复习记录一起带走 */
  async function exportDb() {
    setBusy('db-export')
    setMessage(null)
    try {
      const blob = await downloadBackup()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stamp = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      a.download = `面试题背诵-备份-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}.db`
      a.click()
      URL.revokeObjectURL(url)
      setMessage({ kind: 'ok', text: '已导出数据库文件，收好它' })
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : '导出失败' })
    } finally {
      setBusy(null)
    }
  }

  /** 整库还原：会覆盖一切，所以必须先在下面那一段里点「确定覆盖」 */
  async function doRestore(file: File) {
    setBusy('db-import')
    setMessage(null)
    try {
      const res = await restoreBackup(file)
      setMessage({ kind: 'ok', text: `已还原，题库共 ${res.total} 题` })
      setConfirmRestore(null)
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : '还原失败' })
      setConfirmRestore(null)
    } finally {
      setBusy(null)
    }
  }

  async function importJson(file: File) {
    setBusy('import')
    setMessage(null)
    try {
      const parsed = JSON.parse(await file.text())
      const list = Array.isArray(parsed) ? parsed : parsed?.questions
      if (!Array.isArray(list) || list.length === 0) {
        setMessage({ kind: 'error', text: '这个文件里没有题目，格式可能不对' })
        return
      }
      const questions: ParsedQuestion[] = list.map((q: unknown) => {
        const item = q as Partial<ParsedQuestion>
        return { question: String(item?.question ?? ''), answer: String(item?.answer ?? '') }
      })
      if (questions.some((q) => !q.question.trim())) {
        setMessage({ kind: 'error', text: '文件里存在空的题干，已取消导入' })
        return
      }
      const source = typeof parsed?.source === 'string' && parsed.source ? parsed.source : file.name
      const res = await saveQuestions(source, questions)
      setMessage({ kind: 'ok', text: `已导入 ${res.total} 题` })
      navigate('/', { replace: true })
    } catch (e) {
      setMessage({
        kind: 'error',
        text: e instanceof SyntaxError ? '这不是有效的 JSON 文件' : e instanceof Error ? e.message : '导入失败',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="screen">
      <div className="navbar">
        <button type="button" className="navbar-action" onClick={() => navigate('/')} aria-label="返回">
          ‹
        </button>
        <span className="navbar-title">题库管理</span>
        <span style={{ minWidth: 44 }} />
      </div>

      {message && (
        <div
          className={message.kind === 'ok' ? 'inline-info' : 'inline-error'}
          role="alert"
          style={{ marginTop: 16 }}
        >
          {message.text}
        </div>
      )}

      <div className="inline-info" style={{ marginTop: 20 }}>
        把题库导出成 JSON 存一份。万一服务端数据丢了，导回来就行。
      </div>

      <div style={{ marginTop: 16 }}>
        <button type="button" className="btn-primary" disabled={busy !== null} onClick={exportJson}>
          {busy === 'export' ? '导出中…' : '导出题库 JSON'}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <input
          ref={jsonRef}
          type="file"
          accept="application/json,.json"
          aria-label="选择 JSON 文件"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importJson(file)
            e.target.value = ''
          }}
        />
        <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => jsonRef.current?.click()}>
          {busy === 'import' ? '导入中…' : '从 JSON 导入'}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn-secondary" onClick={() => navigate('/import')}>
          重新导入 PDF
        </button>
      </div>

      {/* ── 数据库源文件（整库备份）─────────────────────────────────
          和上面的 JSON 是两回事：JSON 只有题目，整库文件连进度、复习记录、
          账号一起带走。服务端数据真丢了，只有靠它才能完整复原。 */}
      <div style={{ marginTop: 32 }}>
        <div className="t-title-2">数据库备份</div>
        <div className="inline-info" style={{ marginTop: 8 }}>
          整库文件包含题目、背诵进度和复习记录。换机器、或者重新发布后数据没了，用它一次还原。
        </div>

        <div style={{ marginTop: 12 }}>
          <button type="button" className="btn-primary" disabled={busy !== null} onClick={exportDb}>
            {busy === 'db-export' ? '导出中…' : '导出数据库文件'}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          <input
            ref={dbRef}
            type="file"
            accept=".db,application/octet-stream"
            aria-label="选择数据库文件"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) setConfirmRestore(file)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn-secondary"
            disabled={busy !== null}
            onClick={() => dbRef.current?.click()}
          >
            {busy === 'db-import' ? '还原中…' : '从数据库文件还原'}
          </button>
        </div>

        {confirmRestore && (
          <div className="inline-error" role="alert" style={{ marginTop: 12 }}>
            <div>
              确定用「{confirmRestore.name}」覆盖当前数据吗？题库、进度、复习记录都会被替换成备份里的。
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1, height: 40 }}
                onClick={() => setConfirmRestore(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, height: 40, background: 'var(--danger)' }}
                disabled={busy !== null}
                onClick={() => void doRestore(confirmRestore)}
              >
                确定覆盖
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 重置进度：行内二次确认，不用弹窗（ued.md S9 交互） */}
      <div style={{ marginTop: 24 }}>
        {confirmReset ? (
          <div className="inline-error" role="alert">
            <div>确定要重置背诵进度吗？题目不会动，只是回到第 1 题。</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ flex: 1, height: 40 }}
                onClick={() => setConfirmReset(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ flex: 1, height: 40, background: 'var(--danger)' }}
                disabled={busy !== null}
                onClick={doResetProgress}
              >
                确定重置
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="t-caption"
            style={{
              width: '100%',
              height: 44,
              border: 'none',
              background: 'transparent',
              color: 'var(--danger)',
              fontFamily: 'inherit',
            }}
            onClick={() => setConfirmReset(true)}
          >
            重置背诵进度
          </button>
        )}
      </div>
    </div>
  )
}
