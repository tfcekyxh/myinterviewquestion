// 密码哈希与登录校验。
// scrypt 来自 Node 内置 crypto —— 不用 bcrypt/argon2，它们需要 node-gyp 编译。
import crypto from 'node:crypto'
import { db, row } from './db.ts'
import type { UserRow } from './db.ts'

const KEY_LEN = 64

/** 生成 salt + scrypt 哈希 */
export function hashPassword(password: string): { hash: Buffer; salt: Buffer } {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(password, salt, KEY_LEN)
  return { hash, salt }
}

/** 定长时间比较，防时序侧信道 */
export function verifyPassword(password: string, hash: Uint8Array, salt: Uint8Array): boolean {
  const candidate = crypto.scryptSync(password, salt, KEY_LEN)
  if (candidate.length !== hash.length) return false
  return crypto.timingSafeEqual(candidate, hash)
}

export function findUser(account: string): UserRow | undefined {
  return row<UserRow>('SELECT id, account, pwd_hash, pwd_salt FROM users WHERE account = ?', account)
}

/** 首次启动时把 .env 里的明文账号密码转成哈希写入 users 表 */
export function ensureUser(account: string | undefined, password: string | undefined): UserRow {
  if (!account || !password) {
    throw new Error('缺少 APP_ACCOUNT / APP_PASSWORD，请检查 .env')
  }
  const existing = findUser(account)
  if (existing) return existing

  const { hash, salt } = hashPassword(password)
  db.prepare('INSERT INTO users (account, pwd_hash, pwd_salt) VALUES (?, ?, ?)').run(account, hash, salt)
  const user = findUser(account)
  if (!user) throw new Error('账号创建失败')
  return user
}

export function login(account: string, password: string): UserRow | null {
  const user = findUser(account)
  // 账号不存在时也走一次 scrypt，避免「用户不存在」与「密码错误」响应耗时不同而被枚举账号
  if (!user) {
    crypto.scryptSync(password, crypto.randomBytes(16), KEY_LEN)
    return null
  }
  return verifyPassword(password, user.pwd_hash, user.pwd_salt) ? user : null
}
