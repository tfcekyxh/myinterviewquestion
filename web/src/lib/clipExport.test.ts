import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShareCancelled, canShareFiles, clipFile, formatBytes, formatClipTime, saveFile } from './clipExport'
import type { Recording } from './recorder'

// jsdom 的 navigator 上没有 canShare / share。这里直接往实例上加属性，
// 比整块替换 globalThis.navigator 安全（不至于把别的地方的依赖踩坏）。
type ShareableNav = Navigator & {
  canShare?: (d: { files?: File[] }) => boolean
  share?: (d: { files?: File[] }) => Promise<void>
}
const nav = navigator as ShareableNav

const REC: Recording = {
  blob: new Blob(['fake-audio'], { type: 'audio/mp4' }),
  mimeType: 'audio/mp4',
  durationMs: 42_000,
}

afterEach(() => {
  // 这里用 Reflect.deleteProperty 而不是 `delete nav.canShare` / 赋值 undefined：
  //   - delete 要求操作数是可选属性（交叉类型上不满足）
  //   - 赋值 undefined 又和 Navigator 原生签名冲突（非空断言都不行）
  //   Reflect 版本不做这几项检查，运行时效果一样。
  Reflect.deleteProperty(nav, 'canShare')
  Reflect.deleteProperty(nav, 'share')
  vi.restoreAllMocks()
})

describe('clipExport · 导出文件名', () => {
  it('带题号和时间戳，扩展名由 mimeType 推导', () => {
    const f = clipFile(37, REC, new Date(2026, 9, 14, 18, 30, 22).getTime())
    expect(f.name).toBe('第37题-20261014-183022.m4a')
    expect(f.type).toBe('audio/mp4')
  })

  it('webm 的录音不会被写成 .m4a（绝不能写死扩展名）', () => {
    const f = clipFile(1, { ...REC, mimeType: 'audio/webm;codecs=opus' }, 0)
    expect(f.name.endsWith('.webm')).toBe(true)
  })
})

describe('clipExport · 展示格式', () => {
  it('体积：小于 1MB 用 KB，否则用 MB', () => {
    expect(formatBytes(0)).toBe('0 KB')
    expect(formatBytes(512)).toBe('1 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })

  it('乱码值不会显示成 NaN', () => {
    expect(formatBytes(Number.NaN)).toBe('0 KB')
    expect(formatBytes(-1)).toBe('0 KB')
  })

  it('列表时间显示月-日 时:分', () => {
    expect(formatClipTime(new Date(2026, 9, 14, 18, 30).getTime())).toBe('10-14 18:30')
  })
})

describe('clipExport · 能不能调系统分享面板', () => {
  it('只有 share、没有 canShare → 不算支持', () => {
    nav.share = async () => undefined
    expect(canShareFiles(new File([], 'a.m4a'))).toBe(false)
  })

  it('canShare 明确认可「传这个文件」才算支持', () => {
    nav.share = async () => undefined
    // 原生 Navigator.canShare 的入参是可选的，交叉过来后 d 可能 undefined，这里显式兜一下
    nav.canShare = (d: { files?: File[] } | undefined) =>
      Array.isArray(d?.files) && (d?.files?.length ?? 0) === 1
    expect(canShareFiles(new File([], 'a.m4a'))).toBe(true)
  })

  it('canShare 自己抛异常要兜住，不许炸到 UI', () => {
    nav.share = async () => undefined
    nav.canShare = () => {
      throw new Error('boom')
    }
    expect(canShareFiles(new File([], 'a.m4a'))).toBe(false)
  })
})

describe('clipExport · 保存路径', () => {
  beforeEach(() => {
    // jsdom 不实现 <a download> 的导航，真点一下会往输出里吐一堆 "Not implemented"。
    // 挡掉它，测试输出才看得出来是真失败还是噪音。
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })
  it('支持分享 → 走系统面板', async () => {
    const share = vi.fn(async () => undefined)
    nav.share = share
    nav.canShare = () => true

    expect(await saveFile(new File(['x'], 'a.m4a'))).toBe('shared')
    expect(share).toHaveBeenCalledOnce()
  })

  it('用户在面板里取消 → 抛 ShareCancelled（调用方据此安静地什么都不做）', async () => {
    const abort = new Error('cancelled')
    abort.name = 'AbortError'
    nav.share = vi.fn(async () => {
      throw abort
    })
    nav.canShare = () => true

    await expect(saveFile(new File(['x'], 'a.m4a'))).rejects.toBeInstanceOf(ShareCancelled)
  })

  it('分享报错但不是取消 → 降级下载，不把错误抛给 UI', async () => {
    nav.share = vi.fn(async () => {
      throw new Error('一次不能传这么多')
    })
    nav.canShare = () => true
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')

    expect(await saveFile(new File(['x'], 'a.m4a'))).toBe('downloaded')
    expect(create).toHaveBeenCalled()
  })

  it('不支持分享 → 降级下载，且不能立刻回收 URL', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    expect(await saveFile(new File(['x'], 'a.m4a'))).toBe('downloaded')
    expect(create).toHaveBeenCalled()
    // ⚠️ 立刻 revoke 会把还没开始的下载掐断，iOS 上表现为「点了没反应」
    expect(revoke).not.toHaveBeenCalled()
  })
})
