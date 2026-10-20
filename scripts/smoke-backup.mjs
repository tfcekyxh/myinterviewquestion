// 整库导出 / 还原的接口级往返验证。
//
// 这是「服务端数据丢了也不怕」最强的那条保险，必须证明它真的能把**进度和复习记录**
// 一起救回来 —— 只验题目是不够的（那是 P2.5 的 JSON 导出该干的事）。
//
// 自己起一个一次性服务 + 一个临时数据库，跑完删掉，不碰 data/ 里的任何东西。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = Number(process.env.PORT ?? 3102)
const BASE = `http://127.0.0.1:${PORT}`
const account = process.env.APP_ACCOUNT ?? 'admin'
const password = process.env.APP_PASSWORD

const results = []
function check(name, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name} → ${JSON.stringify(actual)}`)
}

async function call(p, init = {}) {
  const res = await fetch(BASE + p, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    redirect: 'manual',
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  const type = res.headers.get('content-type') ?? ''
  let body
  if (type.includes('application/json')) body = await res.json().catch(() => null)
  else if (type.includes('octet-stream')) body = Buffer.from(await res.arrayBuffer())
  else body = await res.text()
  return { status: res.status, body, setCookie, type }
}

const qs = (n) => Array.from({ length: n }, (_, i) => ({ question: `第 ${i + 1} 题？`, answer: `答案 ${i + 1}` }))

if (!password) {
  console.error('缺少 APP_PASSWORD。用法：APP_PASSWORD=xxx node scripts/smoke-backup.mjs')
  process.exit(1)
}

const dbPath = path.join(os.tmpdir(), `smoke-backup-${Date.now()}.db`)
const server = spawn(process.execPath, ['server/index.ts'], {
  env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), DB_PATH: dbPath },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const serverLog = []
server.stdout.on('data', (d) => serverLog.push(String(d)))
server.stderr.on('data', (d) => serverLog.push(String(d)))

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`)
      if (r.ok) return
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`服务没起来：\n${serverLog.join('')}`)
}

try {
  await waitUp()

  const login = await call('/api/login', { method: 'POST', body: JSON.stringify({ account, password }) })
  if (login.status !== 200) throw new Error(`登录失败：${JSON.stringify(login.body)}`)
  const cookie = login.setCookie.map((c) => c.split(';')[0]).join('; ')
  const json = (b) => JSON.stringify(b)

  // ── 造一份有内容的数据：5 题 + 背到第 3 题 + 1 条复习记录 ──
  let r = await call('/api/questions', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: json({ source: 'backup.pdf', questions: qs(5) }),
  })
  check('准备 5 题', r.status, 200)

  r = await call('/api/progress', {
    method: 'PUT',
    headers: { Cookie: cookie },
    body: json({ posOrder: 3, roundStart: 0 }),
  })
  check('背到第 3 题', r.body?.posOrder, 3)

  r = await call('/api/reviews', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: json({ seq: 2, durationMs: 12_000, clipKey: 'local:2' }),
  })
  check('写一条复习记录', r.status, 200)

  // ── 1. 导出整库文件 ──
  r = await call('/api/backup', { headers: { Cookie: cookie } })
  check('导出 → 200', r.status, 200)
  check('导出的是二进制', r.type, (v) => v.includes('octet-stream'))
  const dump = Buffer.isBuffer(r.body) ? r.body : Buffer.alloc(0)
  check('文件头是 SQLite', dump.subarray(0, 15).toString('latin1'), 'SQLite format 3')
  check('文件不为空', dump.length, (v) => v > 4096)

  // ── 2. 故意把数据毁掉：换成 1 题（顺带会清空进度）──
  r = await call('/api/questions', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: json({ source: '毁掉.json', questions: [{ question: '临时', answer: '临时' }] }),
  })
  check('题库被覆盖成 1 题', r.body?.total, 1)
  r = await call('/api/progress', { headers: { Cookie: cookie } })
  check('进度被清掉了', r.body?.posOrder, 0)
  r = await call('/api/reviews', { headers: { Cookie: cookie } })
  // 换题库会连复习记录一起清掉：记录里的 question_id 指向的是旧题，
  // 留着就是一堆指向空气的脏数据，「复习过几题」也会一直显示错的数字
  check('复习记录被清掉了', r.body?.total, 0)

  // ── 3. 还原 ──
  r = await call('/api/backup', {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' },
    body: dump,
  })
  check('还原 → 200', r.status, 200)
  check('还原后题数 = 5', r.body?.total, 5)

  r = await call('/api/questions', { headers: { Cookie: cookie } })
  check('题库恢复成 5 题', r.body?.total, 5)

  r = await call('/api/progress', { headers: { Cookie: cookie } })
  check('进度恢复到第 3 题', r.body?.posOrder, 3)

  r = await call('/api/reviews', { headers: { Cookie: cookie } })
  check('复习记录恢复了', r.body?.total, 1)

  // 关键：还原不能把人踢下线（sessions 表也被换掉了）
  r = await call('/api/me', { headers: { Cookie: cookie } })
  check('还原后仍是登录态', r.status, 200)

  // ── 4. 坏文件必须被挡住，且线上数据一个字节都不动 ──
  for (const [name, body, expectStatus] of [
    ['随机的二进制 → 400', Buffer.from('这不是一个数据库，只是一段文字'.repeat(50)), 400],
    ['空文件 → 400', Buffer.alloc(0), 400],
    [
      '能打开但缺表 → 400',
      (() => {
        // 一个「真的是 SQLite、但缺表」的文件：最容易被漏过去的那一类
        const tmp = path.join(os.tmpdir(), `not-ours-${Date.now()}.db`)
        const d = new DatabaseSync(tmp)
        d.exec('CREATE TABLE foo (x)')
        d.close()
        const b = fs.readFileSync(tmp)
        fs.rmSync(tmp, { force: true })
        return b
      })(),
      400,
    ],
  ]) {
    const res = await fetch(`${BASE}/api/backup`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' },
      body,
    })
    check(name, res.status, expectStatus)
  }

  r = await call('/api/questions', { headers: { Cookie: cookie } })
  check('坏文件没把题库弄坏（仍是 5 题）', r.body?.total, 5)

  // 未登录不能导出 / 还原。
  // 注意还原必须带 application/octet-stream：带 json 头的话会被全局的 express.json
  // 先当成 JSON 去解析二进制，直接 400 —— 到不了鉴权那一步。真实前端一直是 octet-stream。
  r = await call('/api/backup')
  check('未登录导出 → 401', r.status, 401)
  r = await call('/api/backup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: dump,
  })
  check('未登录还原 → 401', r.status, 401)
} catch (e) {
  console.error('\n[冒烟中断]', e.message)
  console.error(serverLog.join(''))
  server.kill('SIGKILL')
  process.exit(1)
} finally {
  server.kill('SIGKILL')
  fs.rmSync(dbPath, { force: true })
  for (const suffix of ['-journal', '-wal', '-shm', '.bak']) fs.rmSync(dbPath + suffix, { force: true })
}

const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
