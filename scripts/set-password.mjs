// 直接改数据库文件里的账号密码。
//
// 为什么需要这个脚本：**改 .env 里的 APP_PASSWORD 是不会生效的**。
// `ensureUser()` 只在用户不存在时写库，用户一旦建好就直接 return。
// 所以换密码只能改 `users` 表的 pwd_hash / pwd_salt —— 而删库重来会把题库和进度一起丢掉。
//
// 用法：
//   node scripts/set-password.mjs <db文件> <账号> <新密码>
// 例：
//   node scripts/set-password.mjs data/app.db admin 'my-new-password'
//
// ⚠️ 改的是服务端那个库文件，改完要重启服务（或让服务重新加载）才生效。
//    线上改法：先 GET /api/backup 下载库文件 → 本地改 → POST /api/restore 传回去。
import fs from 'node:fs'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const [file, account, password] = process.argv.slice(2)
if (!file || !account || !password) {
  console.error('用法：node scripts/set-password.mjs <db文件> <账号> <新密码>')
  process.exit(1)
}
if (!fs.existsSync(file)) {
  console.error(`找不到数据库文件：${file}`)
  process.exit(1)
}

// 必须和 server/auth.js 里的参数一致：scrypt，salt 16 字节，密钥 64 字节
const KEY_LEN = 64
const salt = crypto.randomBytes(16)
const hash = crypto.scryptSync(password, salt, KEY_LEN)

const db = new DatabaseSync(file)
const user = db.prepare('SELECT id FROM users WHERE account = ?').get(account)
if (!user) {
  const all = db.prepare('SELECT account FROM users').all().map((r) => r.account)
  console.error(`库里没有账号「${account}」。现有账号：${all.join('、') || '（空）'}`)
  db.close()
  process.exit(1)
}

db.prepare('UPDATE users SET pwd_hash = ?, pwd_salt = ? WHERE id = ?').run(hash, salt, user.id)

// 立刻验一遍，别等到线上才发现没写进去
const row = db.prepare('SELECT pwd_hash, pwd_salt FROM users WHERE id = ?').get(user.id)
const ok = crypto.timingSafeEqual(crypto.scryptSync(password, row.pwd_salt, KEY_LEN), row.pwd_hash)
if (!ok) {
  console.error('写入后校验失败，密码没有被改成预期值')
  db.close()
  process.exit(1)
}

// 顺手把旧 session 全清掉：换密码不该让拿着旧凭证的人还挂着登录态
db.prepare('DELETE FROM sessions').run()
db.close()

console.log(`✓ 账号「${account}」的密码已更新（${file}）`)
console.log('  旧的登录态已全部失效，需要重新登录。')
