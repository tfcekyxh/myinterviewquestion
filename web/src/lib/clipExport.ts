// 把录音「交给系统」：优先唤起 iPhone 的原生分享面板，落到「文件」App / iCloud / 语音备忘录；
// 不支持的老浏览器降级成下载。
//
// 为什么不直接用 `<a download>` 就完事：iOS Safari 上 download 属性的行为一直别扭
// （容易变成在新标签里打开、或直接被忽略），而 **Web Share API Level 2（iOS 15+）**
// 能直接唤起系统分享面板，这才是 iPhone 上最自然的一条路——用户自己决定存哪儿。
//
// 值得注意的是：这里出去的数据流向是**用户自己的设备 / 用户自己的 iCloud**，
// 不经过我们的服务端，所以不违背「音频不上云」那条约束。

import type { Recording } from './recorder'
import { clipFileName } from './recorder'

export type SaveOutcome = 'shared' | 'downloaded'

/** 用户在系统分享面板里按了「取消」。这是正常结果，不是错误 */
export class ShareCancelled extends Error {
  constructor() {
    super('已取消')
    this.name = 'ShareCancelled'
  }
}

/** 由录音构造一个带规范文件名的 File。文件名沿用 recorder 里的规则：第N题-时间戳.m4a */
export function clipFile(seq: number, rec: Recording, at: number = Date.now()): File {
  return new File([rec.blob], clipFileName(seq, rec.mimeType, at), { type: rec.mimeType })
}

type ShareableNavigator = Navigator & {
  canShare?: (data: { files?: File[] }) => boolean
  share?: (data: { files?: File[] }) => Promise<void>
}

/**
 * 这个环境能不能「分享文件」（而不是只能分享文字 / 链接）。
 * 必须真的把 files 传进去问 —— 只检查 `typeof navigator.share === 'function'`
 * 会在「支持分享但不支持传文件」的浏览器上翻车。
 */
export function canShareFiles(file: File): boolean {
  const nav = navigator as ShareableNavigator
  if (typeof nav.canShare !== 'function' || typeof nav.share !== 'function') return false
  try {
    return nav.canShare({ files: [file] }) === true
  } catch {
    return false
  }
}

/** 降级路径：造一个临时 <a download> 触发下载 */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // ⚠️ 不能立刻 revoke：下载还没真正开始就被掐断，iOS 上表现为「点了没反应」。
  // 延后一段时间释放，够 Safari 把 blob 读走。
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * 存一段录音。优先级：系统分享面板 → 直接下载。
 * @throws ShareCancelled 用户中途取消（调用方据此静默返回，不要报错）
 */
export async function saveFile(file: File): Promise<SaveOutcome> {
  if (canShareFiles(file)) {
    const nav = navigator as ShareableNavigator
    try {
      await nav.share!({ files: [file] })
      return 'shared'
    } catch (e) {
      // 取消面板 ≠ 失败
      if ((e as { name?: string })?.name === 'AbortError') throw new ShareCancelled()
      // 其他原因（比如一次性传太多被拒）落到下面的下载路径
    }
  }
  downloadFile(file)
  return 'downloaded'
}

/** 录音列表里的体积展示。录音是几十 KB 到几 MB，KB / MB 两档足够 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 列表里的时间：10-14 18:30。今年就不用看年份了 */
export function formatClipTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
