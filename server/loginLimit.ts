// 登录防爆破：按账号计数的内存限流器。
//
// 为什么按账号而不是按 IP：只有本人一个账号，而手机会在 Wi-Fi / 4G 间切换，
// IP 一直变 —— 按 IP 计数要么挡不住换网爆破，要么把本人锁在门外。
// 按账号计数对单账号应用正好：所有失败都汇到同一个计数器上。
//
// 代价（明确接受）：攻击者可以故意输错 5 次把本人锁在门外 10 分钟。
// 对个人题库应用来说这是合理的取舍 —— 真要天天被锁，说明有人在打你，那更该锁。
//
// ⚠️ 计数器在内存里，服务重启即清零（重发 / 崩溃恢复都会重置）。
// 真要跨重启持久化，得把每次失败写进 SQLite —— 那是给高频场景准备的，
// 个人应用每次失败多一次磁盘写不划算，且重启本身低频，可接受。
//
// 窗口语义：15 分钟内失败满 5 次 → 锁 10 分钟。
// 锁定期内的尝试直接拒绝、不再计数，所以解锁时刻固定为「最后一次失败 + 10 分钟」，
// 不会因为一直被戳而无限续期。
const MAX_FAILURES = 5 // 窗口内允许的失败次数
const WINDOW_MS = 15 * 60 * 1000 // 失败计数窗口：15 分钟
const LOCK_MS = 10 * 60 * 1000 // 锁定时长：10 分钟

// 账号 key 上限。攻击者可以拿一堆不存在的账号乱试，每个都会留下一个 key，
// 不清理就是无限增长。超了先清空桶，还不够就整体重置 —— 个人应用的流量下
// 不可能误伤，宁可偶尔放松一次限制也不能让内存被慢慢吃掉。
const MAX_KEYS = 2000

export interface LoginGate {
  locked: boolean
  /** 锁定时距解锁还剩多少毫秒；未锁为 0 */
  retryAfterMs: number
  /** 当前窗口内已失败次数（不管锁没锁，用于日志） */
  attempts: number
}

/** account -> 窗口内失败时刻的数组 */
const failures = new Map<string, number[]>()

let now: () => number = () => Date.now()

/** 仅测试用：替换时钟，方便用假时间验证「到期自动解锁」 */
export function __setClock(fn: () => number): void {
  now = fn
}

function key(account: string): string {
  return account.trim()
}

/** 丢掉窗口外的失败时刻，顺手把空桶删掉，防止 Map 只增不减 */
function prune(): void {
  const cutoff = now() - WINDOW_MS
  for (const [k, times] of failures) {
    const kept = times.filter((t) => t > cutoff)
    if (kept.length === 0) failures.delete(k)
    else if (kept.length !== times.length) failures.set(k, kept)
  }
}

/** 查这个账号现在能不能试 */
export function checkLoginGate(account: string): LoginGate {
  prune()
  const times = failures.get(key(account))
  if (!times || times.length === 0) return { locked: false, retryAfterMs: 0, attempts: 0 }
  const last = times[times.length - 1]
  if (last === undefined) return { locked: false, retryAfterMs: 0, attempts: 0 }
  if (times.length < MAX_FAILURES) return { locked: false, retryAfterMs: 0, attempts: times.length }
  const retryAfterMs = last + LOCK_MS - now()
  return { locked: retryAfterMs > 0, retryAfterMs: Math.max(0, retryAfterMs), attempts: times.length }
}

/** 记一次失败，返回窗口内累计次数 */
export function recordLoginFailure(account: string): number {
  const k = key(account)
  const times = failures.get(k) ?? []
  times.push(now())
  if (failures.size >= MAX_KEYS && !failures.has(k)) {
    prune()
    if (failures.size >= MAX_KEYS) failures.clear()
  }
  failures.set(k, times)
  return times.length
}

/** 登录成功，把这个账号的失败记录清掉 */
export function recordLoginSuccess(account: string): void {
  failures.delete(key(account))
}

/** 清空全部计数（测试用；线上没有需要调它的场景） */
export function resetLoginLimits(): void {
  failures.clear()
}
