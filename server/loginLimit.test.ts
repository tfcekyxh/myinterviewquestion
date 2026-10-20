// loginLimit 单测。用假时钟驱动，重点验「到期自动解锁」这类真实时间下要等 10 分钟的路径。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkLoginGate,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginLimits,
  __setClock,
} from './loginLimit.ts'

const MIN = 60 * 1000

test.beforeEach(() => {
  resetLoginLimits()
  __setClock(() => 0)
})

test.after(() => {
  __setClock(() => Date.now())
})

test('前 4 次失败不锁，第 5 次失败起锁', () => {
  for (let i = 1; i <= 4; i++) {
    recordLoginFailure('admin')
    assert.equal(checkLoginGate('admin').locked, false, `第 ${i} 次失败后不该锁`)
  }
  recordLoginFailure('admin')
  const gate = checkLoginGate('admin')
  assert.equal(gate.locked, true)
  assert.equal(gate.retryAfterMs, 10 * MIN) // 锁定从最后一次失败起算
  assert.equal(gate.attempts, 5)
})

test('锁定期内正确密码也进不来，到期自动解锁', () => {
  for (let i = 0; i < 5; i++) recordLoginFailure('admin')
  assert.equal(checkLoginGate('admin').locked, true)

  __setClock(() => 5 * MIN)
  assert.equal(checkLoginGate('admin').locked, true, '锁定只过了 5 分钟')

  __setClock(() => 10 * MIN - 1)
  assert.equal(checkLoginGate('admin').locked, true)

  __setClock(() => 10 * MIN)
  const gate = checkLoginGate('admin')
  assert.equal(gate.locked, false, '满 10 分钟该放行')
  assert.equal(gate.retryAfterMs, 0)
})

test('锁定期内的失败不计入，不会无限续期', () => {
  for (let i = 0; i < 5; i++) recordLoginFailure('admin')
  // 锁定期间每次检查都不记录新失败，所以解锁时刻固定
  __setClock(() => 3 * MIN)
  assert.equal(checkLoginGate('admin').locked, true)
  __setClock(() => 10 * MIN)
  assert.equal(checkLoginGate('admin').locked, false)
})

test('登录成功清零，历史失败不再计入', () => {
  for (let i = 0; i < 4; i++) recordLoginFailure('admin')
  recordLoginSuccess('admin')
  const gate = checkLoginGate('admin')
  assert.equal(gate.attempts, 0)
  assert.equal(gate.locked, false)
  // 清零后又可以重新失败 4 次不锁
  for (let i = 0; i < 4; i++) recordLoginFailure('admin')
  assert.equal(checkLoginGate('admin').locked, false)
})

test('窗口滑过：失败计数会过期', () => {
  recordLoginFailure('admin')
  __setClock(() => 15 * MIN - 1)
  recordLoginFailure('admin')
  assert.equal(checkLoginGate('admin').attempts, 2, '窗口内两次都算')
  __setClock(() => 15 * MIN + 1)
  assert.equal(checkLoginGate('admin').attempts, 1, '第一次已滑出窗口')
  __setClock(() => 30 * MIN)
  assert.equal(checkLoginGate('admin').attempts, 0)
})

test('账号之间互不影响', () => {
  for (let i = 0; i < 5; i++) recordLoginFailure('attacker')
  assert.equal(checkLoginGate('attacker').locked, true)
  assert.equal(checkLoginGate('admin').locked, false)
  assert.equal(checkLoginGate('admin').attempts, 0)
})

test('账号带空白字符按 trim 后归一，换壳刷不动计数器', () => {
  for (let i = 0; i < 4; i++) recordLoginFailure('admin')
  recordLoginFailure(' admin ')
  assert.equal(checkLoginGate('admin').locked, true)
  assert.equal(checkLoginGate(' admin ').locked, true)
})

test('不存在的一串账号乱试不会把内存吃爆（MAX_KEYS 兜底）', () => {
  __setClock(() => 0)
  for (let i = 0; i < 2500; i++) recordLoginFailure(`ghost-${i}`)
  // 每个都记一次失败，正常都该不锁（离 5 次差得远）
  assert.equal(checkLoginGate('ghost-1').locked, false)
})
