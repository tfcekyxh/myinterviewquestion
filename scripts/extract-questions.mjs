// P0：用真实 PDF 跑一遍解析，输出 questions.json 与统计，供人工抽验。
// 解析规则直接复用前端模块 web/src/lib/pdf/parse.ts（Node 22 可直接跑 .ts），保证同源。
import fs from 'node:fs'
import path from 'node:path'
import { parseItems } from '../web/src/lib/pdf/parse.ts'

const pdfFile = process.argv[2] ?? 'pdf/Java 热门面试题 200 道速记通关版 面试刷题 mianshiyacom.pdf'
const outFile = process.argv[3] ?? 'tmp/questions.json'

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const data = new Uint8Array(fs.readFileSync(pdfFile))
const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise

const items = []
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const tc = await page.getTextContent()
  for (const it of tc.items) {
    if (!it.str) continue
    items.push({
      page: p,
      str: it.str,
      size: it.height || Math.hypot(it.transform[2], it.transform[3]),
      x: it.transform[4],
      y: it.transform[5],
      width: it.width || 0,
    })
  }
}

const t0 = Date.now()
const result = parseItems(items)
console.log(`解析耗时 ${Date.now() - t0}ms`)
console.log('统计:', JSON.stringify({ ...result.stats, bodySize: +result.stats.bodySize.toFixed(2) }, null, 0))
console.log('题目数:', result.questions.length)
console.log('告警数:', result.warnings.length)
result.warnings.slice(0, 20).forEach((w) => console.log('  ⚠ ' + w))

fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, JSON.stringify(result.questions, null, 2))

const lens = result.questions.map((q) => q.answer.length)
console.log('\n答案长度: 最短', Math.min(...lens), '最长', Math.max(...lens), '平均', Math.round(lens.reduce((a, b) => a + b, 0) / lens.length))
console.log('无答案题数:', result.questions.filter((q) => !q.answer.trim()).length)
console.log('输出:', outFile)
