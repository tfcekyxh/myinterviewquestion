// 把录到的 webm 转成 MP4 + GIF，并拼接带片头卡片的完整演示视频。
//
// 产物（demo/output/）：
//   clips/<片段>.mp4   交付用：libx264 / crf 20 / yuv420p / faststart，无音轨
//   clips/<片段>.gif   内嵌文档用：ffmpeg 解码 + 管道喂 gifski（跨帧调色板，
//                       对这种大面积静止的 UI 录屏体积小、无 256 色色带）
//   full/demo-full.mp4 完整演示视频：片头卡片（2.5s）+ 片段，依次拼接
//
// 用法：node demo/convert.mjs（依赖 ffmpeg 与 gifski：brew install ffmpeg gifski）
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CLIPS, CLIPS_DIR, FULL_DIR, RAW_DIR } from './scripts/constants.ts'

const FPS = 30
/** GIF 帧率：UI 录屏 12fps 足够，体积是第一杠杆 */
const GIF_FPS = 12
/** GIF 宽度：竖屏 390px 逻辑分辨率，1:1 不缩放 */
const GIF_WIDTH = 390
/** 单条 GIF 超过这个体积就不适合内嵌到文档里了 */
const GIF_BUDGET_MB = 3
/** 片头卡片时长（秒） */
const CARD_SECONDS = 2.5

function assertTools() {
  for (const bin of ['ffmpeg', 'gifski']) {
    try {
      execFileSync('which', [bin])
    } catch {
      throw new Error(`找不到 ${bin}，请先安装：brew install ${bin}`)
    }
  }
}

function sizeMb(p) {
  return statSync(p).size / 1024 / 1024
}

/** 跑一条命令并等待退出，非 0 退出就带上 stderr 抛错。 */
async function runAsync(cmd, args) {
  const proc = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  proc.stderr.on('data', (d) => (err += d))
  const code = await new Promise((res) => proc.on('exit', res))
  if (code !== 0) throw new Error(`${cmd} 失败（退出码 ${code}）：\n${err.trim()}`)
}

/** ffmpeg 解码并缩放，产物经管道交给 gifski 编码。 */
async function toGif(webm, out) {
  const ff = spawn(
    'ffmpeg',
    ['-v', 'error', '-i', webm, '-vf', `fps=${GIF_FPS},scale=${GIF_WIDTH}:-2:flags=lanczos`, '-f', 'yuv4mpegpipe', '-'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const gif = spawn(
    'gifski',
    ['--fps', String(GIF_FPS), '--width', String(GIF_WIDTH), '--quality', '85', '--motion-quality', '70', '--lossy-quality', '70', '-o', out, '-'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  ff.stdout.pipe(gif.stdin)
  const [ffCode, gifCode, ffErr, gifErr] = await Promise.all([
    new Promise((r) => ff.on('exit', r)),
    new Promise((r) => gif.on('exit', r)),
    new Response(ff.stderr).text(),
    new Response(gif.stderr).text(),
  ])
  if (ffCode !== 0) throw new Error(`ffmpeg 失败（退出码 ${ffCode}）：\n${ffErr.trim()}`)
  if (gifCode !== 0) throw new Error(`gifski 失败（退出码 ${gifCode}）：\n${gifErr.trim()}`)
}

/** 片段 webm → mp4。统一 30fps + yuv420p，保证后面能无损拼接 */
async function clipToMp4(webm, out) {
  await runAsync('ffmpeg', [
    '-y', '-v', 'error', '-i', webm,
    '-vf', `fps=${FPS},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-an', '-movflags', '+faststart',
    out,
  ])
}

/** 片头卡片 PNG → 2.5s mp4（淡入淡出） */
async function cardToMp4(png, out) {
  await runAsync('ffmpeg', [
    '-y', '-v', 'error',
    '-loop', '1', '-i', png,
    '-t', String(CARD_SECONDS),
    '-vf',
    `fps=${FPS},format=yuv420p,fade=t=in:st=0:d=0.5,fade=t=out:st=${CARD_SECONDS - 0.5}:d=0.5`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-an', '-movflags', '+faststart',
    out,
  ])
}

async function main() {
  assertTools()
  mkdirSync(CLIPS_DIR, { recursive: true })
  mkdirSync(FULL_DIR, { recursive: true })

  // 1. 逐条转码
  for (const clip of CLIPS) {
    const webm = resolve(RAW_DIR, `${clip.id}.webm`)
    if (!existsSync(webm)) {
      throw new Error(`缺少 ${webm}\n先录这条：npx playwright test -c demo/playwright.config.ts --grep ${clip.id.slice(0, 2)}`)
    }
    const mp4 = resolve(CLIPS_DIR, `${clip.id}.mp4`)
    const gif = resolve(CLIPS_DIR, `${clip.id}.gif`)
    await clipToMp4(webm, mp4)
    await toGif(webm, gif)
    const gifMb = sizeMb(gif)
    const over = gifMb > GIF_BUDGET_MB ? `  ⚠️ 超过 ${GIF_BUDGET_MB}MB，可下调 GIF_WIDTH` : ''
    console.log(`${clip.id.padEnd(16)} ${clip.title.padEnd(26)} gif ${gifMb.toFixed(2)}MB  mp4 ${sizeMb(mp4).toFixed(2)}MB${over}`)
  }

  // 2. 片头卡片（现画现转）
  execFileSync('node', [resolve(process.cwd(), 'demo/scripts/gen-title-cards.mjs')], { stdio: 'inherit' })

  // 3. 拼接：卡片 + 片段 + 卡片 + 片段 ……
  const segDir = resolve(FULL_DIR, 'segments')
  mkdirSync(segDir, { recursive: true })
  const lines = []
  for (const clip of CLIPS) {
    const cardPng = resolve(FULL_DIR, `card-${clip.id}.png`)
    const cardMp4 = resolve(segDir, `card-${clip.id}.mp4`)
    await cardToMp4(cardPng, cardMp4)
    lines.push(`file '${cardMp4}'`, `file '${resolve(CLIPS_DIR, `${clip.id}.mp4`)}'`)
  }
  const listFile = resolve(segDir, 'concat.txt')
  writeFileSync(listFile, lines.join('\n') + '\n')
  const full = resolve(FULL_DIR, 'demo-full.mp4')
  await runAsync('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', full])

  console.log(`\n完整演示视频：${full}（${sizeMb(full).toFixed(2)}MB）`)
  console.log(`片段目录：${CLIPS_DIR}`)
}

await main()
