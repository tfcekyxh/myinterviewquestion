import { describe, expect, it } from 'vitest'
import { clipFileName, extForMime, formatClock, isRecorderSupported, pickMimeType } from './recorder'

describe('extForMime —— 「绝不写死 .webm」这条约束的落点', () => {
  it('Chromium / iPhone 实际给的 mp4 类型 → m4a', () => {
    // 实测：Chromium 的 MediaRecorder 出 audio/mp4;codecs=opus，iPhone 出 audio/mp4
    expect(extForMime('audio/mp4;codecs=opus')).toBe('m4a')
    expect(extForMime('audio/mp4')).toBe('m4a')
  })

  it('webm / ogg / wav / mp3 各自正确', () => {
    expect(extForMime('audio/webm;codecs=opus')).toBe('webm')
    expect(extForMime('audio/webm')).toBe('webm')
    expect(extForMime('audio/ogg;codecs=opus')).toBe('ogg')
    expect(extForMime('audio/wav')).toBe('wav')
    expect(extForMime('audio/mpeg')).toBe('mp3')
  })

  it('大小写混写也认得', () => {
    expect(extForMime('AUDIO/MP4;CODECS=OPUS')).toBe('m4a')
  })

  it('完全不认识的类型退成 bin，而不是瞎猜成 webm', () => {
    expect(extForMime('application/octet-stream')).toBe('bin')
    expect(extForMime('')).toBe('bin')
  })
})

describe('clipFileName', () => {
  it('带题号和按 mimeType 推出来的扩展名', () => {
    const name = clipFileName(12, 'audio/mp4;codecs=opus', new Date(2026, 9, 11, 9, 5, 3).getTime())
    expect(name).toBe('第12题-20261011-090503.m4a')
  })

  it('webm 场景不会变成 m4a', () => {
    expect(clipFileName(3, 'audio/webm;codecs=opus', new Date(2026, 9, 11).getTime())).toMatch(/\.webm$/)
  })
})

describe('formatClock', () => {
  it('补零到 mm:ss', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(14_000)).toBe('00:14')
    expect(formatClock(67_000)).toBe('01:07')
    expect(formatClock(187_000)).toBe('03:07')
  })

  it('负数与脏数据退成 00:00', () => {
    expect(formatClock(-5)).toBe('00:00')
    expect(formatClock(Number.NaN)).toBe('00:00')
  })
})

describe('pickMimeType', () => {
  it('按优先级挑：mp4 优先（iPhone 只认它）', () => {
    const chosen = pickMimeType((t) => t === 'audio/mp4' || t === 'audio/webm')
    expect(chosen).toBe('audio/mp4')
  })

  it('只支持 webm 时就选 webm', () => {
    expect(pickMimeType((t) => t.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
  })

  it('一个都不支持时返回 undefined，交给浏览器自己决定', () => {
    expect(pickMimeType(() => false)).toBeUndefined()
  })
})

describe('isRecorderSupported', () => {
  it('jsdom 里没有 MediaRecorder，必须报「不支持」而不是崩掉', () => {
    // 这条同时保护了「组件测试不该碰真录音」这个前提
    expect(typeof MediaRecorder).toBe('undefined')
    expect(isRecorderSupported()).toBe(false)
  })
})
