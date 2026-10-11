import { describe, expect, it } from 'vitest'
import type { ProgressState } from './api'
import { currentSeq, cursor, doneCount, isFinished, patchForCount, seqsFor, shuffle, withCount } from './recite'

function progress(over: Partial<ProgressState> = {}): ProgressState {
  return { mode: 'order', posOrder: 0, posRandom: 0, randOrder: [], roundStart: null, lastRound: null, total: 4, updatedAt: null, ...over }
}

describe('shuffle', () => {
  it('是排列：元素一个不多一个不少', () => {
    const out = shuffle([1, 2, 3, 4, 5, 6, 7, 8])
    expect(out.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('不改动入参', () => {
    const src = [1, 2, 3, 4]
    shuffle(src)
    expect(src).toEqual([1, 2, 3, 4])
  })

  it('确实会打乱顺序（注入固定随机源）', () => {
    const out = shuffle([1, 2, 3, 4], () => 0)
    expect(out).not.toEqual([1, 2, 3, 4])
    expect(out.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
  })
})

describe('位置语义：位置是「已背题数」，不是下标', () => {
  it('doneCount 把负数/脏数据当成 0', () => {
    expect(doneCount(progress({ posOrder: -3 }))).toBe(0)
    expect(doneCount(progress({ posOrder: Number.NaN }))).toBe(0)
  })

  it('已背 128 时停留的题是第 129 题（下标 128）', () => {
    const p = progress({ posOrder: 128, total: 240 })
    expect(doneCount(p)).toBe(128)
    expect(cursor(p, 240)).toBe(128)
    expect(currentSeq(p, Array.from({ length: 240 }, (_, i) => i + 1))).toBe(129)
  })

  it('背完时（已背 = N）游标停在最后一题，不越界', () => {
    const p = progress({ posOrder: 4, total: 4 })
    expect(isFinished(p, 4)).toBe(true)
    expect(cursor(p, 4)).toBe(3)
    expect(currentSeq(p, [1, 2, 3, 4])).toBe(4)
  })

  it('随机模式读的是 posRandom，与顺序模式互不干扰', () => {
    const p = progress({ mode: 'random', posOrder: 3, posRandom: 1, randOrder: [4, 2, 1, 3] })
    expect(doneCount(p)).toBe(1)
    expect(currentSeq(p, [1, 2, 3, 4])).toBe(2)
  })

  it('withCount / patchForCount 只动当前模式的位置', () => {
    const p = progress({ mode: 'random', posOrder: 3, posRandom: 0, randOrder: [4, 2, 1, 3] })
    expect(withCount(p, 2)).toMatchObject({ posOrder: 3, posRandom: 2 })
    expect(patchForCount('random', 2)).toEqual({ posRandom: 2 })
    expect(patchForCount('order', 2)).toEqual({ posOrder: 2 })
  })
})

describe('seqsFor', () => {
  it('顺序模式返回题库原序', () => {
    expect(seqsFor(progress(), [1, 2, 3, 4])).toEqual([1, 2, 3, 4])
  })

  it('随机模式返回存下来的序列', () => {
    expect(seqsFor(progress({ mode: 'random', randOrder: [3, 1, 4, 2] }), [1, 2, 3, 4])).toEqual([3, 1, 4, 2])
  })

  it('随机序列与题库对不上时退回原序，绝不渲染空白', () => {
    expect(seqsFor(progress({ mode: 'random', randOrder: [3, 1] }), [1, 2, 3, 4])).toEqual([1, 2, 3, 4])
  })
})
