import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveQuestions } from '../lib/api'
import { PdfError, extractItems } from '../lib/pdf/extract'
import { parseItems, type ParseResult } from '../lib/pdf/parse'

type Stage = 'select' | 'parsing' | 'result' | 'saving'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function Import() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [stage, setStage] = useState<Stage>('select')
  const [progress, setProgress] = useState({ page: 0, total: 0 })
  const [result, setResult] = useState<ParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startParse() {
    if (!file) return
    setStage('parsing')
    setError(null)
    try {
      const items = await extractItems(file, (p) => setProgress(p))
      const parsed = parseItems(items)
      if (parsed.questions.length === 0) {
        // 扫描件（无文本层）或排版完全不认识，都会走到这里。
        // 不直接抛 parse.ts 的告警原文（里面「需要 OCR」是行话），换成用户能看懂的说法
        setError(
          '这个 PDF 里没有抽到任何文字，可能是扫描件（图片版）。请先用识别工具转成文字版 PDF 再导入。',
        )
        setStage('select')
        return
      }
      setResult(parsed)
      setStage('result')
    } catch (e) {
      setError(e instanceof PdfError ? e.message : e instanceof Error ? e.message : '解析失败')
      setStage('select')
    }
  }

  async function confirm() {
    if (!result || !file) return
    setStage('saving')
    setError(null)
    try {
      await saveQuestions(
        file.name,
        result.questions.map((q) => ({ question: q.question, answer: q.answer })),
      )
      navigate('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : '入库失败')
      setStage('result')
    }
  }

  const answered = result?.questions.filter((q) => q.answer.trim()).length ?? 0
  const pending = result?.warnings.length ?? 0

  return (
    <div className="screen">
      <div className="navbar">
        <button type="button" className="navbar-action" onClick={() => navigate('/')} aria-label="返回">
          ‹
        </button>
        <span className="navbar-title">{stage === 'result' ? '解析完成' : '导入题库'}</span>
        <span style={{ minWidth: 44 }} />
      </div>

      {error && (
        <div className="inline-error" role="alert" style={{ marginTop: 16 }}>
          {error}
        </div>
      )}

      {stage === 'select' && (
        <>
          <div style={{ marginTop: 20 }}>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              aria-label="选择 PDF 文件"
              hidden
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
              }}
            />
            <button
              type="button"
              className="placeholder"
              style={{ width: '100%', border: '1px dashed var(--line)', fontFamily: 'inherit' }}
              onClick={() => inputRef.current?.click()}
            >
              <span style={{ fontSize: 28 }}>＋</span>
              <span className="t-body-strong">点击选择 PDF 文件</span>
              <span className="t-caption color-text-3">支持 .pdf；扫描版图片需要额外识别</span>
            </button>
          </div>

          {file && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="t-body-strong truncate">{file.name}</div>
              <div className="t-caption color-text-3" style={{ marginTop: 4 }}>
                {formatSize(file.size)}
              </div>
            </div>
          )}

          <div className="inline-info" style={{ marginTop: 16 }}>
            解析会按 PDF 的排版自动切分题目与答案，入库前可以先看前几题对不对。
          </div>

          <div style={{ flex: 1 }} />
          <button type="button" className="btn-primary" disabled={!file} onClick={startParse}>
            开始解析
          </button>
        </>
      )}

      {stage === 'parsing' && (
        <div style={{ marginTop: 32 }}>
          <div className="t-title-2">正在解析…</div>
          <div className="t-caption color-text-2" style={{ marginTop: 8 }}>
            {progress.total ? `第 ${progress.page} / ${progress.total} 页` : '正在读取文件'}
          </div>
          <div className="progress-bar" style={{ marginTop: 16 }}>
            <span style={{ width: progress.total ? `${(progress.page / progress.total) * 100}%` : '0%' }} />
          </div>
        </div>
      )}

      {/* 必须把 saving 也算进来：否则一点「确认入库」，stage 变成 saving
          就会整块卸载，界面闪回选文件页，「入库中…」永远看不到。 */}
      {(stage === 'result' || stage === 'saving') && result && (
        <>
          <div style={{ marginTop: 20 }} className="metrics">
            <div className="metric">
              <div className="metric-value">{result.questions.length}</div>
              <div className="metric-label">题目</div>
            </div>
            <div className="metric">
              <div className="metric-value">{answered}</div>
              <div className="metric-label">有答案</div>
            </div>
            <div className={`metric${pending ? ' warn' : ''}`}>
              <div className="metric-value">{pending}</div>
              <div className="metric-label">处待确认</div>
            </div>
          </div>

          <div className="t-title-2" style={{ marginTop: 24 }}>
            前 3 题预览
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            {result.questions.slice(0, 3).map((q) => (
              <div key={q.seq} className="card">
                <div className="t-body-strong truncate">{q.question}</div>
                <div className="t-caption color-text-3 truncate" style={{ marginTop: 4 }}>
                  {q.answer.split('\n')[0]}
                </div>
              </div>
            ))}
          </div>

          {pending > 0 && (
            <div className="inline-error" style={{ marginTop: 16 }}>
              {result.warnings.slice(0, 3).join('；')}
            </div>
          )}

          <div style={{ flex: 1 }} />
          <button type="button" className="btn-primary" disabled={stage === 'saving'} onClick={confirm}>
            {stage === 'saving' ? '入库中…' : '确认入库'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            style={{ marginTop: 12 }}
            disabled={stage === 'saving'}
            onClick={() => {
              setResult(null)
              setFile(null)
              setStage('select')
            }}
          >
            重新导入
          </button>
        </>
      )}
    </div>
  )
}
