// parsePoints 纯函数单测，用 Node 内置测试运行器（node --test）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePoints } from './llm.js'

test('parsePoints 去掉前缀符号与编号', () => {
  const out = parsePoints('· 第一点\n- 第二点\n3. 第三点\n\n  4、第四点')
  assert.deepEqual(out, ['第一点', '第二点', '第三点', '第四点'])
})

test('parsePoints 丢弃空行', () => {
  const out = parsePoints('· 一条\n\n   \n· 另一条')
  assert.deepEqual(out, ['一条', '另一条'])
})

test('parsePoints 空输入返回空数组', () => {
  assert.deepEqual(parsePoints(''), [])
  assert.deepEqual(parsePoints('   \n  '), [])
})

test('parsePoints 最多保留 8 条', () => {
  const many = Array.from({ length: 12 }, (_, i) => `· 点${i}`).join('\n')
  assert.equal(parsePoints(many).length, 8)
})
