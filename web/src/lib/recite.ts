// 背诵模式的纯逻辑：洗牌与进度换算。
// 抽出来单放，是因为这几条规则（位置语义、两套位置、随机序列）最容易出错，
// 而且能脱离 DOM 直接单测。
import type { ProgressPatch, ProgressState, ReciteMode } from './api'

/** Fisher-Yates。rnd 可注入，便于测试。 */
export function shuffle<T>(arr: readonly T[], rnd: () => number = Math.random): T[] {
  const out = arr.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/**
 * 位置的正确定义是「已背题数」，不是数组下标。
 * 这样它才能取到 N —— 表示这一轮背完了（「已背 240 / 240」）。
 * 顺序/随机各记一个，来回切不丢。
 */
export function doneCount(p: ProgressState): number {
  const n = p.mode === 'order' ? p.posOrder : p.posRandom
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** 当前停留的题在序列里的下标（用于渲染） */
export function cursor(p: ProgressState, len: number): number {
  if (len <= 0) return 0
  return Math.min(doneCount(p), len - 1)
}

/** 是否已经背完这一轮 */
export function isFinished(p: ProgressState, len: number): boolean {
  return len > 0 && doneCount(p) >= len
}

/** 当前模式下的题目序号序列。随机序列与题库对不上时退回原序，绝不渲染出空白。 */
export function seqsFor(p: ProgressState, allSeqs: readonly number[]): number[] {
  if (p.mode === 'order') return allSeqs.slice()
  return p.randOrder.length === allSeqs.length ? p.randOrder.slice() : allSeqs.slice()
}

/** 写入某个模式的位置（进度存的是「已背题数」） */
export function patchForCount(mode: ReciteMode, count: number): ProgressPatch {
  return mode === 'order' ? { posOrder: count } : { posRandom: count }
}

/** 只改当前模式的位置，显式构造对象 —— 比展开 Partial 更不容易漏字段 */
export function withCount(p: ProgressState, count: number): ProgressState {
  return p.mode === 'order' ? { ...p, posOrder: count } : { ...p, posRandom: count }
}

/** 当前停留题目的 seq（1 基题号），用于首页「上次背到第 Y 题」 */
export function currentSeq(p: ProgressState, allSeqs: readonly number[]): number {
  const seqs = seqsFor(p, allSeqs)
  return seqs[cursor(p, seqs.length)] ?? allSeqs[0] ?? 1
}

/** 复习范围：刚背完的一轮 / 整个题库 */
export type ReviewScope = 'round' | 'all'

/** 「刚背完的一轮」的题号；没有记录就是空数组（此时 S5 里那张卡 disabled） */
export function roundSeqs(p: ProgressState | null): number[] {
  const seqs = p?.lastRound?.seqs
  return Array.isArray(seqs) ? seqs.slice() : []
}

/** 「第 5 – 10 题」这样的范围文案。随机模式下首尾不是连续区间，所以取 min/max。 */
export function seqRangeLabel(seqs: readonly number[]): string {
  if (!seqs.length) return ''
  let lo = seqs[0]
  let hi = seqs[0]
  for (const s of seqs) {
    if (s < lo) lo = s
    if (s > hi) hi = s
  }
  return `第 ${lo} – ${hi} 题`
}

/**
 * 复习用的题目序号序列。
 * 顺序模式原样返回；随机模式洗一遍（洗牌在调用处只做一次并存进 state，
 * 否则每次 render 都会换顺序）。
 */
export function reviewSeqs(
  scope: ReviewScope,
  mode: ReciteMode,
  allSeqs: readonly number[],
  lastRound: readonly number[],
): number[] {
  const base = scope === 'round' ? lastRound.slice() : allSeqs.slice()
  return mode === 'random' ? shuffle(base) : base
}
