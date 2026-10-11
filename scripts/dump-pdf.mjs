// PDF 结构探查：按页导出文本项（含字号、字体名、坐标），用于确定切题规则。
// 仅开发期使用，不进应用代码。
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

const file = process.argv[2] ?? 'pdf/Java 热门面试题 200 道速记通关版 面试刷题 mianshiyacom.pdf'
const outDir = process.argv[3] ?? 'tmp'

const data = new Uint8Array(fs.readFileSync(file))
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
console.log('页数:', doc.numPages)

const items = []
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const tc = await page.getTextContent()
  for (const it of tc.items) {
    if (!it.str) continue
    items.push({
      page: p,
      str: it.str,
      // transform: [a, b, c, d, e, f]，d 为主尺度（字号近似）
      size: it.height || Math.hypot(it.transform[2], it.transform[3]),
      font: it.fontName,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width,
      eol: it.hasEOL,
    })
  }
}

fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(
  path.join(outDir, 'items.json'),
  JSON.stringify(items.map((i) => ({ ...i, size: +i.size.toFixed(2), x: +i.x.toFixed(1), y: +i.y.toFixed(1), w: +i.w.toFixed(1) }))),
)

// 字号分布
const sizes = {}
for (const it of items) {
  const k = it.size.toFixed(1)
  sizes[k] = sizes[k] || { n: 0, fonts: new Set() }
  sizes[k].n++
  sizes[k].fonts.add(it.font)
}
console.log('\n字号分布（top 12）：')
Object.entries(sizes)
  .sort((a, b) => b[1].n - a[1].n)
  .slice(0, 12)
  .forEach(([k, v]) => console.log(`  size=${k}  项数=${v.n}  字体=${[...v.fonts].join(',')}`))

const fonts = {}
for (const it of items) fonts[it.font] = (fonts[it.font] || 0) + 1
console.log('\n字体分布：')
Object.entries(fonts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${k}: ${v}`))
