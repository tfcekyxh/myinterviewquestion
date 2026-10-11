// 把 items.json 按「页 + y 坐标」还原成行，观察字号分布，确认题干特征。
import fs from 'node:fs'

const items = JSON.parse(fs.readFileSync('tmp/items.json', 'utf8'))

// 按页分组，按 y 聚成行（PDF 坐标 y 向上）
const byPage = new Map()
for (const it of items) {
  if (!byPage.has(it.page)) byPage.set(it.page, [])
  byPage.get(it.page).push(it)
}

const lines = []
for (const [page, arr] of byPage) {
  arr.sort((a, b) => b.y - a.y || a.x - b.x)
  let cur = null
  for (const it of arr) {
    if (cur && Math.abs(it.y - cur.y) <= 1.5) {
      cur.items.push(it)
    } else {
      cur = { page, y: it.y, items: [it] }
      lines.push(cur)
    }
  }
}
for (const l of lines) {
  l.items.sort((a, b) => a.x - b.x)
  l.text = l.items.map((i) => i.str).join('')
  const total = l.items.reduce((s, i) => s + i.size * i.str.length, 0)
  const len = l.items.reduce((s, i) => s + i.str.length, 0)
  l.size = +(total / len).toFixed(2)
}

fs.writeFileSync('tmp/lines.json', JSON.stringify(lines.map((l) => ({ page: l.page, y: +l.y.toFixed(1), size: l.size, text: l.text }))))

const buckets = {}
for (const l of lines) {
  const k = l.size.toFixed(1)
  buckets[k] = (buckets[k] || 0) + 1
}
console.log('行数字号分布（top 10）:')
Object.entries(buckets).sort((a, b) => b[1] - a[1]).slice(0, 10)
  .forEach(([k, v]) => console.log(`  size=${k}  行数=${v}`))

console.log('\n===== 前 40 行（size >= 9）=====')
lines.filter((l) => l.size >= 9 && l.text.trim()).slice(0, 40)
  .forEach((l) => console.log(`p${l.page} ${l.size} | ${l.text}`))

console.log('\n===== 前 30 行（page 1，含全部字号）=====')
lines.filter((l) => l.page === 1).slice(0, 30)
  .forEach((l) => console.log(`  ${l.size} | ${l.text}`))
