// P1 冒烟：登录链路的接口级验证（curl 在本机会走代理，这里用 fetch 直连，并显式绕过）
// 用法：先启动服务（npm run dev:server 或 PORT=3000 node server/index.ts），再跑 node scripts/smoke-auth.mjs
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

function cookieOf(setCookie) {
  return setCookie.map((c) => c.split(';')[0]).join('; ')
}

const results = []
function check(name, actual, expected) {
  const ok = typeof expected === 'function' ? expected(actual) : actual === expected
  results.push({ name, ok, actual })
  console.log(`${ok ? '✓' : '✗'} ${name} → ${JSON.stringify(actual)}`)
}

if (!password) {
  console.error('缺少 APP_PASSWORD。用法：APP_PASSWORD=xxx node scripts/smoke-auth.mjs')
  process.exit(1)
}

// 1. 未登录访问受保护接口
let r = await call('/api/me')
check('未登录访问 /api/me → 401', r.status, 401)

// 2. 错误密码
r = await call('/api/login', { method: 'POST', body: JSON.stringify({ account, password: 'wrong-password' }) })
check('错误密码登录 → 401', r.status, 401)

// 3. 不存在的账号
r = await call('/api/login', { method: 'POST', body: JSON.stringify({ account: 'nobody', password }) })
check('不存在的账号 → 401', r.status, 401)

// 4. 缺参数
r = await call('/api/login', { method: 'POST', body: JSON.stringify({ account }) })
check('缺密码 → 400', r.status, 400)

// 5. 正确密码
r = await call('/api/login', { method: 'POST', body: JSON.stringify({ account, password }) })
check('正确密码登录 → 200', r.status, 200)
const cookie = cookieOf(r.setCookie)
check('Set-Cookie 存在', cookie.length > 0, true)
check('Cookie 是 HttpOnly', r.setCookie.join(';').toLowerCase().includes('httponly'), true)

// 6. 带 Cookie 访问受保护接口
r = await call('/api/me', { headers: { Cookie: cookie } })
check('带 Cookie 访问 /api/me → 200', r.status, 200)
check('返回账号正确', r.body?.account, account)

// 7. 登出后立即失效
r = await call('/api/logout', { method: 'POST', headers: { Cookie: cookie } })
check('登出 → 200', r.status, 200)
r = await call('/api/me', { headers: { Cookie: cookie } })
check('登出后旧 Cookie 失效 → 401', r.status, 401)

const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length ? 1 : 0)
