import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ErrorScreen from '../components/ErrorScreen'
import { fetchFullBank, type Question } from '../lib/api'
import { listClips, deleteClip, seqOfClip, type StoredClip } from '../lib/audioStore'
import {
  ShareCancelled,
  clipFile,
  formatBytes,
  formatClipTime,
  saveFile,
} from '../lib/clipExport'
import { formatClock } from '../lib/recorder'

/**
 * 我的录音（ued 里没有这一屏，是后补的）。
 *
 * 为什么要补：之前 `audioStore` 里虽然写了 loadClip / clipStats / deleteClip，
 * 但**全项目没有任何地方调用** —— 录音存进 IndexedDB 之后就读不回来了。
 * 回放条只在「刚录完 → 对照答案」那一屏活着，一旦点「下一题」被 clearClip 清掉，
 * 那段录音等于白存。所以这里一口气补齐三件事：**看得见、听得着、留得下**。
 *
 * 一个刻意的降级：拿不到题库（网络挂了 / 服务没起）时**照样列出录音**，
 * 只是不显示题干。录音在本机上，不该被服务端故障挡在门外。
 */
export default function Clips() {
  const navigate = useNavigate()

  const [clips, setClips] = useState<StoredClip[]>([])
  const [bank, setBank] = useState<Map<number, Question>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // 回听中的那一段。url 和 key 绑在同一个 state 里 —— 分开存会有一帧不同步
  const [playback, setPlayback] = useState<{ key: string; url: string } | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmBatch, setConfirmBatch] = useState(false)
  const [batch, setBatch] = useState<{ current: number; total: number } | null>(null)
  const batchStoppedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const rows = await listClips()
        // 题库只用来配题干，失败了就退化成「第 N 题」，不影响回听与导出
        const b = await fetchFullBank().catch(() => null)
        if (cancelled) return
        setClips(rows)
        setBank(new Map((b?.questions ?? []).map((q) => [q.seq, q])))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '读不出本机录音')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 卸载时释放最后一条 objectURL
  useEffect(
    () => () => {
      if (playback) URL.revokeObjectURL(playback.url)
    },
    [playback],
  )

  // src 换了之后 autoPlay 不会再触发一次，所以这里手动 play。
  // 切换录音走的是同一帧内的 src 更新，光靠 autoPlay 属性只有第一段能响。
  useEffect(() => {
    if (!playback) return
    const a = audioRef.current
    if (!a) return
    void a.play().catch(() => {
      setMessage({ kind: 'error', text: '这段录音放不了，可能格式本机不支持' })
      stopPlayback()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playback])

  const stopPlayback = () => {
    audioRef.current?.pause()
    setPlayback((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
  }

  function togglePlay(clip: StoredClip) {
    setMessage(null)
    if (playback?.key === clip.key) {
      stopPlayback()
      return
    }
    if (playback) URL.revokeObjectURL(playback.url)
    let url: string | null = null
    try {
      url = URL.createObjectURL(clip.blob)
    } catch {
      setMessage({ kind: 'error', text: '这段录音读不出来，可能本机数据坏了' })
      return
    }
    setPlayback({ key: clip.key, url })
  }

  async function exportOne(clip: StoredClip) {
    setMessage(null)
    try {
      const outcome = await saveFile(clipFile(seqOfClip(clip), clip, clip.createdAt))
      setMessage({
        kind: 'ok',
        text: outcome === 'shared' ? '已交给系统，选「存储到「文件」」就能留档' : '已下载到本机',
      })
    } catch (e) {
      if (e instanceof ShareCancelled) return // 用户自己取消的，不打扰
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : '导出失败' })
    }
  }

  /** 批量导出：iOS 一次只能弹一个分享面板，所以只能串行要求用户逐个确认 */
  async function exportAll() {
    setConfirmBatch(false)
    setMessage(null)
    batchStoppedRef.current = false
    setBatch({ current: 0, total: clips.length })
    for (let i = 0; i < clips.length; i++) {
      if (batchStoppedRef.current) {
        setMessage({ kind: 'ok', text: `已停止，导出了前 ${i} 段` })
        break
      }
      setBatch({ current: i, total: clips.length })
      const clip = clips[i]
      try {
        await saveFile(clipFile(seqOfClip(clip), clip, clip.createdAt))
      } catch (e) {
        if (e instanceof ShareCancelled) {
          setMessage({ kind: 'ok', text: `已停止，导出了前 ${i} 段` })
          break
        }
        setMessage({
          kind: 'error',
          text: `第 ${i + 1} 段导出失败：${e instanceof Error ? e.message : '未知原因'}`,
        })
        break
      }
    }
    setBatch(null)
  }

  async function doDelete(clip: StoredClip) {
    setMessage(null)
    if (playback?.key === clip.key) stopPlayback()
    await deleteClip(clip.key)
    setClips((prev) => prev.filter((c) => c.key !== clip.key))
    setConfirmDelete(null)
    setMessage({ kind: 'ok', text: '已删除这一段' })
  }

  if (loading) return <div className="screen-center">加载中…</div>

  if (error) {
    return <ErrorScreen message={error} action={{ label: '返回', onClick: () => navigate('/') }} />
  }

  const totalBytes = clips.reduce((n, c) => n + (c.blob?.size ?? 0), 0)
  const busy = batch !== null

  return (
    <div className="screen">
      <div className="navbar">
        <button type="button" className="navbar-action" onClick={() => navigate('/')} aria-label="返回">
          ‹
        </button>
        <span className="navbar-title">我的录音</span>
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

      {clips.length === 0 ? (
        <div style={{ marginTop: 32 }}>
          <div className="inline-info">还没有录音。复习时对着题目讲一段，讲完就会存在这里。</div>
          <div style={{ marginTop: 16 }}>
            <button type="button" className="btn-primary" onClick={() => navigate('/review')}>
              去复习
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginTop: 20 }}>
            <div style={{ fontSize: 24, lineHeight: '32px', fontWeight: 600 }}>
              {clips.length} 段录音
            </div>
            <div className="t-caption color-text-2" style={{ marginTop: 4 }}>
              共 {formatBytes(totalBytes)}，只存在这台手机上
            </div>
            <div className="t-caption color-text-3" style={{ marginTop: 8 }}>
              清 Safari 缓存或换手机会丢。想留住就用下面的导出。
            </div>
          </div>

          {batch && (
            <div className="inline-info" role="status" style={{ marginTop: 12 }}>
              正在导出 {batch.current + 1} / {batch.total}…
            </div>
          )}

          {busy ? (
            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  batchStoppedRef.current = true
                }}
              >
                停止导出
              </button>
            </div>
          ) : !confirmBatch ? (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="btn-primary" onClick={() => setConfirmBatch(true)}>
                导出全部录音
              </button>
            </div>
          ) : (
            <div className="inline-info" style={{ marginTop: 12 }}>
              <div>
                iPhone 一次只能存一个文件，会依次弹出 {clips.length} 次分享面板。每次选
                「存储到「文件」」即可。
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ flex: 1, height: 40 }}
                  onClick={() => setConfirmBatch(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ flex: 1, height: 40 }}
                  onClick={exportAll}
                >
                  开始导出
                </button>
              </div>
            </div>
          )}

          <div className="scroll-area" style={{ marginTop: 20 }}>
            {clips.map((clip) => {
              const seq = seqOfClip(clip)
              const q = bank.get(seq)
              const playing = playback?.key === clip.key
              return (
                <div key={clip.key} className="card" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span className="t-body-strong">第 {seq} 题</span>
                    <span className="t-caption color-text-3">{formatClipTime(clip.createdAt)}</span>
                    <span style={{ flex: 1 }} />
                    <span className="t-caption color-text-2">{formatClock(clip.durationMs)}</span>
                  </div>

                  {q && (
                    <div className="t-caption color-text-2 truncate" style={{ marginTop: 6 }}>
                      {q.question}
                    </div>
                  )}
                  <div className="t-micro color-text-3" style={{ marginTop: 4 }}>
                    {formatBytes(clip.blob?.size ?? 0)}
                  </div>

                  {confirmDelete === clip.key ? (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ flex: 1, height: 36 }}
                        onClick={() => setConfirmDelete(null)}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ flex: 1, height: 36, color: 'var(--danger)' }}
                        onClick={() => void doDelete(clip)}
                      >
                        确定删除
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ flex: 1, height: 36 }}
                        disabled={busy}
                        onClick={() => togglePlay(clip)}
                      >
                        {playing ? '停止' : '回听'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ flex: 1, height: 36 }}
                        disabled={busy}
                        onClick={() => void exportOne(clip)}
                      >
                        导出
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ flex: 1, height: 36 }}
                        disabled={busy}
                        onClick={() => setConfirmDelete(clip.key)}
                      >
                        删除
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {playback && (
        <audio
          ref={audioRef}
          src={playback.url}
          hidden
          onEnded={stopPlayback}
          onError={() => {
            setMessage({ kind: 'error', text: '这段录音放不了，可能格式本机不支持' })
            stopPlayback()
          }}
        />
      )}
    </div>
  )
}
