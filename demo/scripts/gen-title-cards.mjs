// 生成完整演示视频的片头卡片（每条片段一段 2.5 秒）。
//
// 用 Chromium 渲染 HTML 再截图 —— ffmpeg 的 drawtext 对中文字体支持很差
// （ttc 字体集合经常挑错字重），而页面截图能直接用 PingFang SC，
// 配色也顺手对齐 web/src/styles.css 的设计令牌。
//
// 用法：node demo/scripts/gen-title-cards.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import { CLIPS, FULL_DIR, QUESTION_COUNT, VIEWPORT } from './constants.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 设计令牌取自 web/src/styles.css */
const TOKENS = {
  primary: '#2563eb',
  deep: '#1e3a8a',
  bg: '#f5f6f8',
  text1: '#141a23',
  text2: '#69737f',
  text3: '#98a1ac',
  line: '#e6e9ee',
}

function cardHtml(clip, index) {
  const [main, ...rest] = clip.title.split('：')
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: -apple-system, "PingFang SC", "SF Pro Text", sans-serif; }
  .card {
    width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px;
    background: linear-gradient(160deg, ${TOKENS.deep} 0%, ${TOKENS.primary} 100%);
    color: #fff; display: flex; flex-direction: column; justify-content: center;
    padding: 0 44px; box-sizing: border-box; position: relative; overflow: hidden;
  }
  .glow { position: absolute; right: -120px; top: -120px; width: 320px; height: 320px;
    border-radius: 50%; background: rgba(255,255,255,.08); }
  .glow2 { position: absolute; left: -80px; bottom: -80px; width: 220px; height: 220px;
    border-radius: 50%; background: rgba(255,255,255,.06); }
  .kicker { font-size: 13px; letter-spacing: 4px; opacity: .75; }
  .no { font-size: 64px; font-weight: 700; margin-top: 18px; line-height: 1; }
  .title { font-size: 30px; font-weight: 600; margin-top: 20px; line-height: 1.35; }
  .sub { font-size: 15px; opacity: .8; margin-top: 10px; line-height: 1.5; }
  .bar { width: 44px; height: 4px; background: #fff; border-radius: 2px; margin-top: 28px; opacity: .9; }
  .foot { position: absolute; left: 44px; bottom: 40px; font-size: 12px; opacity: .6; }
</style></head><body>
  <div class="card">
    <div class="glow"></div><div class="glow2"></div>
    <div class="kicker">面试题背诵 · 功能演示</div>
    <div class="no">${String(index + 1).padStart(2, '0')}</div>
    <div class="title">${main}</div>
    ${rest.length ? `<div class="sub">${rest.join('：')}</div>` : ''}
    <div class="bar"></div>
    <div class="foot">${QUESTION_COUNT} 题题库 · 翻卡 / 朗读 / AI 重点 / 复习录音</div>
  </div>
</body></html>`
}

async function main() {
  const browser = await chromium.launch({ channel: 'chromium' })
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  fs.mkdirSync(FULL_DIR, { recursive: true })
  for (const [i, clip] of CLIPS.entries()) {
    await page.setContent(cardHtml(clip, i), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    const out = path.resolve(FULL_DIR, `card-${clip.id}.png`)
    await page.screenshot({ path: out })
    console.log(`片头卡片 ${out}`)
  }
  await browser.close()
}

await main()
