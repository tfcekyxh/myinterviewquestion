// 朗读音频。GET /api/tts/:seq/:part —— part 是 q（题目）或 a（答案）。
//
// 生成要调外网，可能失败（沙箱没外网、服务临时不可用）。这时返回 503 而不是 500：
// 503 是「现在做不到」，前端见到它就退回 iOS 内置朗读，功能不中断。
import { Router } from 'express'
import { requireAuth } from './auth.js'
import { getAudio } from '../tts.js'

export const ttsRouter = Router()

ttsRouter.use(requireAuth)

ttsRouter.get('/:seq/:part', async (req, res) => {
  const seq = Number(req.params.seq)
  const { part } = req.params

  if (!Number.isInteger(seq) || seq <= 0) {
    return res.status(400).json({ error: '题号不对' })
  }
  if (part !== 'q' && part !== 'a') {
    return res.status(400).json({ error: '段落只能是 q（题目）或 a（答案）' })
  }

  try {
    const buf = await getAudio(seq, part)
    res.set('Content-Type', 'audio/mpeg')
    // 音频内容只随题目变，题目不变就永远有效 —— 缓存一周，翻回去不用重新下载
    res.set('Cache-Control', 'private, max-age=604800')
    res.send(buf)
  } catch (e) {
    const notFound = e?.code === 'NO_QUESTION' || e?.code === 'EMPTY_TEXT'
    if (!notFound) {
      console.error('[朗读音频生成失败]', seq, part, e instanceof Error ? e.message : e)
    }
    res.status(notFound ? 404 : 503).json({
      error: notFound ? '这道题没有可朗读的内容' : '朗读音频生成失败，已退回本机朗读',
    })
  }
})
