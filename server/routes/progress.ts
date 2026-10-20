// 背诵进度：存服务端，跟账号走，所以换设备能接着背（决策 5）。
//
// 为什么顺序和随机要各存一个位置：
//   ued.md S4 要求「切到随机模式时记住当前题位置，切回顺序可继续」。
//   只存一个 position 的话，一切换模式就会把另一种模式的进度顶掉。
import { Router } from 'express'
import type { Request, Response } from 'express'
import { requireAuth } from './auth.ts'
import { db, readProgress, writeProgress, clearProgress, row } from '../db.ts'
import type { ProgressData, StoredProgress } from '../db.ts'

export const progressRouter = Router()

progressRouter.use(requireAuth)

const DEFAULT_MODE = 'order'

interface ProgressPayload extends ProgressData {
  updatedAt: number | null
}

function bankTotal(): number {
  return row<{ c: number }>('SELECT COUNT(*) AS c FROM questions')?.c ?? 0
}

/**
 * 位置的含义是「已背题数」，取值 0..total。
 * 取到 total 是合法状态 —— 表示这一轮背完了（ued.md S4 的完成提示），
 * 所以不能像下标那样夹到 total-1。
 */
function clamp(n: unknown, total: number): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return 0
  return Math.min(n, Math.max(0, total))
}

/**
 * 把任何来源的进度都收敛成「一定能用」的状态。
 * 关键一条：题库规模变了就把位置归零 —— 换题库后旧位置指向的是别的题，比丢掉更糟。
 */
function normalize(state: Partial<StoredProgress> | null | undefined, total: number): ProgressData {
  const s = state ?? {}
  const empty: ProgressData = {
    mode: DEFAULT_MODE,
    posOrder: 0,
    posRandom: 0,
    randOrder: [],
    roundStart: null,
    lastRound: null,
    total,
  }
  if (s.total !== total) return empty

  const mode = s.mode === 'random' ? 'random' : DEFAULT_MODE
  // 随机序列必须是 1..total 的一个排列，否则一律作废（宁可从头发一组新的）
  const randOrder =
    Array.isArray(s.randOrder) && s.randOrder.length === total ? s.randOrder.map(Number) : []

  const lastSeqs = s.lastRound?.seqs
  const lastRound =
    Array.isArray(lastSeqs) && lastSeqs.length > 0 && lastSeqs.length <= total
      ? { seqs: lastSeqs.map(Number), count: lastSeqs.length }
      : null

  const roundStartRaw = s.roundStart
  const roundStart =
    typeof roundStartRaw === 'number' &&
    Number.isInteger(roundStartRaw) &&
    roundStartRaw >= 0 &&
    roundStartRaw < total
      ? roundStartRaw
      : null

  return {
    mode,
    posOrder: clamp(s.posOrder, total),
    posRandom: randOrder.length ? clamp(s.posRandom, total) : 0,
    randOrder,
    roundStart,
    lastRound,
    total,
  }
}

function rangeSeqs(total: number): number[] {
  return Array.from({ length: total }, (_, i) => i + 1)
}

/**
 * 结算「刚背完的一轮」。
 *
 * 一轮的定义：从这一轮的起点，背到最后一题为止。
 *   起点由客户端在进入背诵页时写成「当时的位置」——所以从第 129 题接着背，
 *   这一轮就是 129–240，而不是永远等于整个题库。
 *   done 到达 total（背完）时结算，并清空 roundStart，下一轮重新计。
 */
function settleRound(s: ProgressData): ProgressData {
  const done = s.mode === 'order' ? s.posOrder : s.posRandom
  if (s.total <= 0 || done < s.total) return s
  if (s.roundStart === null) return s // 没有进行中的起点，说明这一轮已经结算过了

  const seqs = s.mode === 'order' ? rangeSeqs(s.total) : s.randOrder
  if (seqs.length !== s.total) return s

  const start = Math.min(s.roundStart, s.total - 1)
  return { ...s, roundStart: null, lastRound: { seqs: seqs.slice(start), count: s.total - start } }
}

function payload(): ProgressPayload {
  const total = bankTotal()
  const stored = readProgress()
  const state = normalize(stored, total)
  return { ...state, total, updatedAt: stored?.updatedAt ?? null }
}

progressRouter.get('/', (_req: Request, res: Response) => {
  res.json(payload())
})

progressRouter.put('/', (req: Request, res: Response) => {
  const total = bankTotal()
  const current = normalize(readProgress(), total)
  const body = req.body ?? {}
  const next: ProgressData = { ...current }

  if (body.mode === 'order' || body.mode === 'random') next.mode = body.mode
  if (Number.isInteger(body.posOrder) && body.posOrder >= 0) next.posOrder = body.posOrder
  if (Number.isInteger(body.posRandom) && body.posRandom >= 0) next.posRandom = body.posRandom
  if (Array.isArray(body.randOrder)) next.randOrder = body.randOrder.filter(Number.isInteger)

  // 显式传 roundStart 才改：传 null 表示「从下一轮重新计」
  if ('roundStart' in body) {
    next.roundStart = Number.isInteger(body.roundStart) && body.roundStart >= 0 ? body.roundStart : null
  }

  const fixed = settleRound(normalize(next, total))
  writeProgress(fixed)
  res.json(payload())
})

/** 重置进度（「我的」页用） */
progressRouter.delete('/', (_req: Request, res: Response) => {
  clearProgress()
  res.json({ ok: true })
})
