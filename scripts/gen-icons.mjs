// 生成「添加到主屏幕」需要的图标。
//
// 为什么自己写：环境里没有图像库（sharp / canvas 都要原生编译），而 iOS 的
// apple-touch-icon **只认 PNG**，给 SVG 不生效。所以这里是纯 Node 的 PNG 编码器
// （zlib + CRC32），零依赖，画的是一张「蓝底白卡片 + 三条文字线」的闪卡。
//
// 用法：node scripts/gen-icons.mjs
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const OUT_DIR = path.resolve('web/public')
const SIZES = [180, 192, 512]
const SS = 4 // 超采样倍数：先画大图再降采样，边缘才不会有锯齿

// 取自 styles.css 的设计令牌
const BG = [0x25, 0x63, 0xeb]
const CARD = [0xff, 0xff, 0xff]
const LINE_STRONG = [0x25, 0x63, 0xeb]
const LINE_SOFT = [0xd3, 0xdd, 0xf0]

/** 归一化坐标（0..1）下的圆角矩形判定 */
function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function shade(u, v) {
  if (!inRoundedRect(u, v, 0.18, 0.18, 0.82, 0.82, 0.1)) return BG
  // 卡片里的三条：粗的一条是「题干」，细的两条是「答案」
  if (inRoundedRect(u, v, 0.27, 0.345, 0.73, 0.415, 0.035)) return LINE_STRONG
  if (inRoundedRect(u, v, 0.27, 0.485, 0.68, 0.54, 0.0275)) return LINE_SOFT
  if (inRoundedRect(u, v, 0.27, 0.575, 0.62, 0.63, 0.0275)) return LINE_SOFT
  return CARD
}

function render(size) {
  const px = Buffer.alloc(size * size * 3)
  const step = 1 / (size * SS)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((x * SS + sx + 0.5) * step, (y * SS + sy + 0.5) * step)
          r += c[0]
          g += c[1]
          b += c[2]
        }
      }
      const n = SS * SS
      const i = (y * size + x) * 3
      px[i] = Math.round(r / n)
      px[i + 1] = Math.round(g / n)
      px[i + 2] = Math.round(b / n)
    }
  }
  return px
}

// ── PNG 编码（RGB，color type 2，无 alpha：图标是满铺的，不需要透明）─────────
const CRC_TABLE = new Int32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c
}

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  // 10/11/12 默认 0：compression / filter / interlace

  // 每行前面要一个 filter 字节（0 = None）
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const png = encodePng(size, render(size))
  const file = path.join(OUT_DIR, `icon-${size}.png`)
  fs.writeFileSync(file, png)
  console.log(`${path.relative(process.cwd(), file)}  ${size}×${size}  ${(png.length / 1024).toFixed(1)} KB`)
}
