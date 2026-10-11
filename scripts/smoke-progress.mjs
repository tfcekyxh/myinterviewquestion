// P3 冒烟：进度接口的接口级验证（含题库规模变化后自动归零这条关键行为）。
// 用法：先启动服务，再跑 node scripts/smoke-progress.mjs
// 注意：会覆盖题库与进度（用 NODE_ENV=test 的服务跑最安全）。
const BASE = process.env.BASE ?? 'http://127.0.0.1:3000'
const account = process.env.APP_ACCOUNT ?? 'admin'
const password = process.env.APP_PASSWORD

async function call(path, init = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    redirect: 'manual',
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  let body
  try {
    body = await res.json()
  } catch {
    body = await res.text()
  }
  return { status: res.status, body, setCookie }
}

const results = []
function check(name, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  results.push({ name, ok, actual })
  console.log(`${ok ? '✓' : '✗'} ${name} → ${JSON.stringify(actual)}`)
}

if (!password) {
  console.error('缺少 APP_PASSWORD。用法：APP_PASSWORD=xxx node scripts/smoke-progress.mjs')
  process.exit(1)
}

const login = await call('/api/login', { method: 'POST', body: JSON.stringify({ account, password }) })
if (login.status !== 200) {
  console.error('登录失败，无法继续：', login.body)
  process.exit(1)
}
const cookie = login.setCookie.map((c) => c.split(';')[0]).join('; ')
const json = (body) => JSON.stringify(body)

const qs = (n) => Array.from({ length: n }, (_, i) => ({ question: `第 ${i + 1} 题？`, answer: `答案 ${i + 1}` }))

// 准备题库：6 题
let r = await call('/api/questions', { method: 'POST', headers: { Cookie: cookie }, body: json({ source: 'smoke.json', questions: qs(6) }) })
check('入库 6 题 → 200', r.status, 200)

// 未登录不能读写进度
r = await call('/api/progress')
check('未登录读进度 → 401', r.status, 401)

// 初始进度
r = await call('/api/progress', { headers: { Cookie: cookie } })
check('初始 mode=order', r.body?.mode, 'order')
check('初始 posOrder=0', r.body?.posOrder, 0)
check('初始 total=6', r.body?.total, 6)

// 顺序模式推进到第 3 题（索引 2）
r = await call('/api/progress', { method: 'PUT', headers: { Cookie: cookie }, body: json({ posOrder: 2 }) })
check('写入 posOrder=2', r.body?.posOrder, 2)

// 切随机：保存一组打乱序列
const shuffled = [4, 1, 6, 2, 5, 3]
r = await call('/api/progress', {
  method: 'PUT',
  headers: { Cookie: cookie },
  body: json({ mode: 'random', randOrder: shuffled, posRandom: 1 }),
})
check('mode 切到 random', r.body?.mode, 'random')
check('randOrder 落库', r.body?.randOrder, (v) => Array.isArray(v) && v.join(',') === shuffled.join(','))
check('posRandom=1', r.body?.posRandom, 1)

// 切回顺序：顺序位置必须还在（这是「两套位置」设计的核心目的）
r = await call('/api/progress', { method: 'PUT', headers: { Cookie: cookie }, body: json({ mode: 'order' }) })
check('切回顺序后 posOrder 仍是 2', r.body?.posOrder, 2)
check('切回顺序后 randOrder 仍在', r.body?.randOrder, (v) => Array.isArray(v) && v.length === 6)

// 乱写的输入不能污染数据
r = await call('/api/progress', { method: 'PUT', headers: { Cookie: cookie }, body: json({ posOrder: 999, randOrder: [1, 2] }) })
check('posOrder 越界被夹到 total(6) —— 6 表示这一轮已背完', r.body?.posOrder, 6)
check('长度不对的 randOrder 被丢弃', r.body?.randOrder, (v) => Array.isArray(v) && v.length === 0)
check('randOrder 作废后 posRandom 归零', r.body?.posRandom, 0)

// 换题库（规模变化）→ 位置必须归零，否则会指到别的题上
r = await call('/api/questions', { method: 'POST', headers: { Cookie: cookie }, body: json({ source: 'smoke2.json', questions: qs(10) }) })
check('换成 10 题题库 → 200', r.status, 200)
r = await call('/api/progress', { headers: { Cookie: cookie } })
check('题库变了 total=10', r.body?.total, 10)
check('题库变了 posOrder 归零', r.body?.posOrder, 0)
check('题库变了 randOrder 清空', r.body?.randOrder, (v) => Array.isArray(v) && v.length === 0)

// 重置
r = await call('/api/progress', { method: 'PUT', headers: { Cookie: cookie }, body: json({ posOrder: 4 }) })
check('写 posOrder=4', r.body?.posOrder, 4)
r = await call('/api/progress', { method: 'DELETE', headers: { Cookie: cookie } })
check('重置进度 → 200', r.status, 200)
r = await call('/api/progress', { headers: { Cookie: cookie } })
check('重置后 posOrder 归零', r.body?.posOrder, 0)

// ── 「刚背完的一轮」结算（题库 10 题）──────────────────────────────
r = await call('/api/progress', { method: 'PUT', headers: { Cookie: cookie }, body: json({ posOrder: 4, roundStart: 4 }) })
check('从第 5 题接着背：roundStart=4', r.body?.roundStart, 4)
check('起点已置但还没背完：lastRound 仍为空', r.body?.lastRound, null)

r = await call('/api/progress', { method: 'PUT', headers: { Cookie: cookie }, body: json({ posOrder: 7 }) })
check('中途前进不动起点', r.body?.roundStart, 4)
check('还没背完不结算', r.body?.lastRound, null)

r = await call('/api/progress', { method: 'PUT', headers: { Cookie: cookie }, body: json({ posOrder: 10 }) })
check('背完后 roundStart 清空', r.body?.roundStart, null)
check(
  '背完结算出第 5–10 题（6 题），而不是整个题库',
  r.body?.lastRound,
  (v) => v && v.count === 6 && v.seqs.join(',') === '5,6,7,8,9,10',
)

// 再背一遍：起点归零，结算出来的就是整个题库
r = await call('/api/progress', { method: 'PUT', headers: { Cookie: cookie }, body: json({ posOrder: 0, roundStart: 0 }) })
check('再背一遍：posOrder 归零', r.body?.posOrder, 0)
check('再背一遍：起点归零', r.body?.roundStart, 0)
check('再背一遍：上一轮的记录还在（首页还能去复习）', r.body?.lastRound, (v) => v && v.count === 6)
r = await call('/api/progress', { method: 'PUT', headers: { Cookie: cookie }, body: json({ posOrder: 10 }) })
check('整轮背完结算出 10 题', r.body?.lastRound, (v) => v && v.count === 10 && v.seqs[0] === 1 && v.seqs[9] === 10)

// 换题库后，上一轮的记录必须作废（题都不是那些题了）
r = await call('/api/questions', { method: 'POST', headers: { Cookie: cookie }, body: json({ source: 'smoke3.json', questions: qs(3) }) })
r = await call('/api/progress', { headers: { Cookie: cookie } })
check('换题库后 lastRound 作废', r.body?.lastRound, null)

// ── 复习记录 ────────────────────────────────────────────────────
r = await call('/api/reviews', { headers: { Cookie: cookie } })
check('复习记录初始为 0', r.body?.total, 0)

r = await call('/api/reviews', { method: 'POST', headers: { Cookie: cookie }, body: json({ seq: 2, durationMs: 12_000, clipKey: 'local:2-abc' }) })
check('写入一条复习记录 → 200', r.status, 200)

r = await call('/api/reviews', { method: 'POST', headers: { Cookie: cookie }, body: json({ durationMs: 1000 }) })
check('缺题号 → 400', r.status, 400)

r = await call('/api/reviews', { method: 'POST', headers: { Cookie: cookie }, body: json({ seq: 999, durationMs: 1000 }) })
check('题号不在题库里 → 404', r.status, 404)

r = await call('/api/reviews', { headers: { Cookie: cookie } })
check('复习记录数=1', r.body?.total, 1)
check('lastAt 有值', r.body?.lastAt, (v) => typeof v === 'number' && v > 0)

r = await call('/api/reviews')
check('未登录读复习记录 → 401', r.status, 401)

const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
