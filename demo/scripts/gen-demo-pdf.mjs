// 生成「演示题库 PDF」：片段 2（PDF 导入）的素材。
//
// 为什么现画一个 PDF，而不是用真实题库 pdf/Java 热门面试题 200 道…pdf：
//  1. 那个文件 33MB，被 .gitignore 挡住，换一台机器就没有；
//  2. 演示要的是「解析成功」的确定性，真实 PDF 的字体子集化还有部首乱码
//     （parse.ts 里的 RADICAL_FIX 就是为它写的），不适合当稳定素材。
//
// 关键约束：字号必须踩中 parse.ts 的切题台阶 —— 题干 / 正文字号比在
// [1.08, 1.6] 之间。这里用 9.65px / 8.25px（比 1.17），与真实题库一致。
// 答案每行以「。」结尾（joinAnswer 视为硬换行，不粘行）且不超宽（不被软折行）。
//
// 用法：node demo/scripts/gen-demo-pdf.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { DEMO_QUESTIONS, DEMO_PDF_NAME } from './questions-demo.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '..', 'assets', DEMO_PDF_NAME)

/** 题干字号：真实题库实测 9.65px（PDF 单位约 7.24pt） */
const Q_SIZE = 9.65
/** 正文字号：真实题库实测 8.25px */
const A_SIZE = 8.25

function html() {
  const items = DEMO_QUESTIONS.map((q) => {
    const answerLines = q.answer
      .split('\n')
      .map((line) => `<div class="a">${escapeHtml(line)}</div>`)
      .join('')
    return `<div class="qa"><div class="q">${escapeHtml(q.question)}</div>${answerLines}</div>`
  }).join('\n')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 0; }
  body { margin: 0; font-family: "PingFang SC", "Hiragino Sans GB", "Songti SC", sans-serif; }
  .cover {
    height: 320px; background: #1e3a8a; color: #fff;
    display: flex; flex-direction: column; justify-content: center; padding: 0 56px;
  }
  .cover h1 { font-size: 18px; margin: 0 0 8px; letter-spacing: 1px; }
  .cover p { font-size: ${A_SIZE}px; margin: 0; opacity: .75; }
  .book { padding: 24px 48px 48px; }
  .qa { margin: 0 0 10px; break-inside: auto; }
  .q { font-size: ${Q_SIZE}px; font-weight: 600; color: #111827; margin: 12px 0 3px; line-height: 1.5; }
  .a { font-size: ${A_SIZE}px; color: #374151; line-height: 1.7; }
</style></head><body>
  <div class="cover">
    <h1>Java 热门面试题 60 道速记通关版</h1>
    <p>演示用题库 · 题干与答案按字号台阶排版，供 PDF 解析演示</p>
  </div>
  <div class="book">
    ${items}
  </div>
</body></html>`
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

async function main() {
  // channel: 'chromium' = 完整版 Chromium。本机缺 chromium_headless_shell-1248
  // （与 e2e/playwright.config.ts 同一个坑），默认 launch 会直接找不到可执行文件
  const browser = await chromium.launch({ channel: 'chromium' })
  const page = await browser.newPage()
  await page.setContent(html(), { waitUntil: 'load' })
  // 等 webfont 就绪再打印，避免标题用后备字体导致字号测量偏差
  await page.evaluate(() => document.fonts.ready)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  await page.pdf({ path: OUT, format: 'A4', printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } })
  await browser.close()
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
  console.log(`已生成 ${OUT}（${kb} KB，${DEMO_QUESTIONS.length} 题）`)
}

await main()
