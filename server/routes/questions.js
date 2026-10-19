// 题库：查询规模、批量入库。
// 入库是「整批替换」：换题库后旧的进度与题一律作废，必须在同一事务里完成。
import { Router } from 'express'
import { requireAuth } from './auth.js'
import { db, getMeta, setMeta } from '../db.js'
import { clearAudioCache } from '../tts.js'

export const questionsRouter = Router()

questionsRouter.use(requireAuth)

/** 题库概况。带 ?full=1 时同时返回全部题目（背诵页用） */
questionsRouter.get('/', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM questions').get().c
  const body = {
    total,
    source: getMeta('source_pdf'),
    importedAt: Number(getMeta('imported_at') ?? 0) || null,
  }
  if (req.query.full === '1') {
    const rows = db.prepare('SELECT seq, question, answer FROM questions ORDER BY seq').all()
    return res.json({ ...body, questions: rows })
  }
  res.json(body)
})

questionsRouter.post('/', (req, res) => {
  const { source, questions } = req.body ?? {}

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: '没有解析到题目，无法入库' })
  }
  if (questions.length > 5000) {
    return res.status(400).json({ error: '题目数量过多（> 5000），请确认是不是解析错了' })
  }
  for (const q of questions) {
    if (!q || typeof q.question !== 'string' || !q.question.trim()) {
      return res.status(400).json({ error: '存在空的题干，请检查解析结果' })
    }
  }

  try {
    db.exec('BEGIN')
    db.prepare('DELETE FROM questions').run()
    // 换了题库，旧进度就没有任何意义了
    db.prepare('DELETE FROM progress').run()
    // 复习记录同理：它记的是 question_id，题一换就成了指向空气的脏数据，
    // 「复习过几题」也会一直显示错的数字
    db.prepare('DELETE FROM reviews').run()
    // 重点与具体某题的答案强绑定，题库一换就是旧的，必须一起清
    db.prepare('DELETE FROM keypoints').run()
    const insert = db.prepare(
      'INSERT INTO questions (seq, question, answer, source_pdf) VALUES (?, ?, ?, ?)',
    )
    questions.forEach((q, i) => {
      insert.run(i + 1, q.question.trim(), String(q.answer ?? ''), typeof source === 'string' ? source : null)
    })
    setMeta('source_pdf', typeof source === 'string' ? source : '')
    setMeta('imported_at', String(Date.now()))
    db.exec('COMMIT')
    // 题目全换了，旧音频指向的是已经不存在的题，一律作废（下次翻到会重新生成）
    clearAudioCache()
  } catch (e) {
    db.exec('ROLLBACK')
    console.error('[入库失败]', e)
    return res.status(500).json({ error: '入库失败，题库未被修改' })
  }

  res.json({ ok: true, total: questions.length })
})
