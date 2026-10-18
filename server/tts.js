// 服务端朗读音频：按需生成 + 文件缓存。
//
// 为什么不一次性生成全部：题库 11.4 万字（答案平均 553 字），全量转音频约 424 分钟 / 99 MB，
// 上传和存储都不现实。所以改成「翻到哪题生成哪题」，生成一次就缓存成文件，之后直接吐字节。
//
// 缓存是可以丢的：它完全由题目文本派生，删掉或重新发布（data/ 会被覆盖）都会自动重新生成。
// 所以它**不进数据库、不进整库备份** —— 那里面装的是没法再生的进度和复习记录。
//
// 生成依赖外网（微软 Edge 的朗读服务）。拿不到时接口返回 503，前端会自己退回 iOS 内置 TTS。
import fs from 'node:fs'
import path from 'node:path'
import { EdgeTTS } from 'node-edge-tts'
import { DB_PATH, db } from './db.js'

const VOICE = 'zh-CN-XiaoxiaoNeural'
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3'
const TIMEOUT_MS = 30_000

// 缓存上限。答案音频约 600KB/段，300MB 大约能放 500 段 —— 超过就从最久没用过的开始删。
const MAX_TOTAL_BYTES = 300 * 1024 * 1024

// 跟着数据库走：冒烟脚本用 DB_PATH 开临时库时，音频也落在临时目录，不会污染 data/
const DIR = path.join(path.dirname(DB_PATH), 'tts')

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true })
}

function audioPath(seq, part) {
  return path.join(DIR, `${seq}-${part}.mp3`)
}

/** 取题目/答案文本并做一点清洗：PDF 抽出来的文本空白很乱，直接喂给 TTS 会念出奇怪的停顿 */
function textOf(seq, part) {
  const row = db.prepare('SELECT question, answer FROM questions WHERE seq = ?').get(seq)
  if (!row) return null
  const raw = part === 'q' ? row.question : row.answer
  return String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 总量超上限就删最久没用过的。命中缓存时会刷新 mtime，所以这里删的是真正的「冷」文件 */
function pruneIfNeeded() {
  let files
  try {
    files = fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith('.mp3'))
      .map((f) => {
        const st = fs.statSync(path.join(DIR, f))
        return { f, size: st.size, mtime: st.mtimeMs }
      })
  } catch {
    return // 目录还不存在，没什么可清的
  }

  let total = files.reduce((n, f) => n + f.size, 0)
  if (total <= MAX_TOTAL_BYTES) return

  files.sort((a, b) => a.mtime - b.mtime)
  for (const item of files) {
    if (total <= MAX_TOTAL_BYTES) break
    try {
      fs.rmSync(path.join(DIR, item.f))
      total -= item.size
    } catch {
      // 删不掉就算了，下次再试
    }
  }
}

// 同一个 key 只生成一次：连点下一题时，并发生成会把同一个文件写两遍
const inflight = new Map()

async function generate(seq, part, text) {
  const dest = audioPath(seq, part)
  // 先写临时文件再改名，避免生成到一半被别的请求读到半截音频
  const tmp = `${dest}.${process.pid}.tmp`
  try {
    const tts = new EdgeTTS({ voice: VOICE, outputFormat: OUTPUT_FORMAT, timeout: TIMEOUT_MS })
    await tts.ttsPromise(text, tmp)
    fs.renameSync(tmp, dest)
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      /* 忽略 */
    }
    throw e
  }
}

/**
 * 拿一段音频。命中缓存直接读文件（并刷新 mtime 让 LRU 知道它刚被用过），
 * 否则现生成一次。
 *
 * @returns {Promise<Buffer>}
 * @throws 题目不存在 / 生成失败（多半是外网不通）
 */
export async function getAudio(seq, part) {
  const key = `${seq}:${part}`

  try {
    const buf = fs.readFileSync(audioPath(seq, part))
    const now = new Date()
    fs.utimesSync(audioPath(seq, part), now, now) // 刷新 mtime = 标记为刚用过
    return buf
  } catch {
    // 没缓存，往下走
  }

  if (inflight.has(key)) return inflight.get(key)

  const text = textOf(seq, part)
  // code 让路由能分得清「这题根本不存在」（404）和「现在生不出来」（503）
  if (text === null) {
    const e = new Error(`没有第 ${seq} 题`)
    e.code = 'NO_QUESTION'
    throw e
  }
  if (!text) {
    const e = new Error(`第 ${seq} 题的${part === 'q' ? '题干' : '答案'}是空的`)
    e.code = 'EMPTY_TEXT'
    throw e
  }

  const task = (async () => {
    ensureDir()
    await generate(seq, part, text)
    pruneIfNeeded()
    return fs.readFileSync(audioPath(seq, part))
  })()

  inflight.set(key, task)
  try {
    return await task
  } finally {
    inflight.delete(key)
  }
}

/** 换了题库就作废：旧的音频指向的是已经不存在的题目 */
export function clearAudioCache() {
  try {
    fs.rmSync(DIR, { recursive: true, force: true })
  } catch {
    // 删不掉就算了，反正题目序号变了也读不到
  }
}
