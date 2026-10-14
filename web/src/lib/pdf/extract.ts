// 浏览器端读取 PDF —— 把 pdfjs 的输出映射成 parse.ts 需要的 RawItem。
// 解析规则本身在 ./parse.ts，两边共用同一份源码。
import type { RawItem } from './parse'

// Vite 会把这个 URL 编译成构建产物里的真实路径。
// pdfjs 必须在 Worker 里跑，否则主线程会被 130 页的解析卡死。
// 用动态 import：pdfjs 有几百 KB，但只有导入页用得上，
// 不能让它拖慢「打开就背题」的首屏。
let workerReady: Promise<typeof import('pdfjs-dist')> | null = null
function loadPdfjs() {
  if (!workerReady) {
    workerReady = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()
      return pdfjs
    })
  }
  return workerReady
}

export interface ExtractProgress {
  page: number
  total: number
}

export class PdfError extends Error {}

/**
 * 抽取全部页面的文本项。
 * PDF 是逐字形绘制的，每个汉字都是一个独立项，靠 y 坐标聚成行（见 parse.ts 的 buildLines）。
 */
export async function extractItems(
  file: File,
  onProgress?: (p: ExtractProgress) => void,
): Promise<RawItem[]> {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdfjs = await loadPdfjs()

  // 注意：pdfjs v6 的类型里已经没有 isEvalSupported 了（该选项已被移除），
  // 传了会被 TS 报错，也确实不生效，这里就不要传。
  const loadingTask = pdfjs.getDocument({ data })
  let doc: Awaited<typeof loadingTask.promise>
  try {
    doc = await loadingTask.promise
  } catch (e) {
    // 加密 / 损坏 / 根本不是 PDF，都在这里冒出来
    throw new PdfError(describePdfError(e))
  }

  try {
    const items: RawItem[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      onProgress?.({ page: p, total: doc.numPages })
      const page = await doc.getPage(p)
      const tc = await page.getTextContent()
      for (const it of tc.items) {
        // getTextContent 的 items 是 TextItem | TextMarkedContent 的联合类型。
        // 标出来的内容（TextMarkedContent）没有 str/transform，必须先窄化，
        // 否则既通不过类型检查，运行时也会炸。
        if (!('str' in it) || !it.str) continue
        items.push({
          page: p,
          str: it.str,
          // height 是 pdfjs 给的字号近似；取不到就用 transform 反推
          size: it.height || Math.hypot(it.transform[2], it.transform[3]),
          x: it.transform[4],
          y: it.transform[5],
          width: it.width || 0,
        })
      }
      // 逐页释放：130 页的文档在手机上不释放会顶到内存上限
      page.cleanup()
    }
    return items
  } finally {
    // pdfjs v6 的 destroy 在 loadingTask 上，PDFDocumentProxy.destroy 已被移除。
    // 关键：清理动作绝不能把已经解析出来的结果吞掉 —— 所以必须 catch 掉。
    // 踩过的坑：写在 finally 里的 `await doc.destroy()` 抛错，直接把解析成功的结果
    // 变成了「解析失败」，页面只显示一句 "destroy is not a function"。
    try {
      await loadingTask.destroy()
    } catch {
      /* 清理失败无所谓的 */
    }
  }
}

function describePdfError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? ''
  const msg = e instanceof Error ? e.message : String(e)
  if (name === 'PasswordException' || /password/i.test(msg)) {
    return '这个 PDF 有密码保护，请先解除密码再导入'
  }
  if (name === 'InvalidPDFException' || /invalid/i.test(msg)) {
    return '文件已损坏或不是有效的 PDF'
  }
  return `无法读取这个 PDF：${msg}`
}
