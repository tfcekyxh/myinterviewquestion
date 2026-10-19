import { expect, test } from './fixtures'
import { readFile } from 'node:fs/promises'
import { QUESTION_COUNT, SEED_CLIP_PATH } from './constants'
import {
  moveAndClick,
  pause,
  prepareClip,
  scrollTo,
  seedIndexedDBClips,
  startClip,
} from './demo-utils'

/**
 * 片段 5：我的录音 + 题库管理。
 *
 * 录音只存本机 IndexedDB，而每条 test 都是全新 context，所以先往
 * IndexedDB 里播种两段真实 webm 音频（key 格式 clip:${题号}:${时间戳}，
 * 页面靠 seqOfClip 从 key 反解题号）。然后回首页走 UI：
 * 我的录音 → 回听 → 返回 → 题库管理 → 导出 JSON。
 */

test('05-clips-bank：我的录音 · 题库管理导出', async ({ page, context }) => {
  await prepareClip(context)

  // 播种两段本机录音（与 audioStore 的 store 结构对齐）
  const webm = await readFile(SEED_CLIP_PATH)
  const base64 = webm.toString('base64')
  const now = Date.now()
  await page.goto('/')
  await expect(page.getByText('下午好')).toBeVisible()
  await seedIndexedDBClips(page, [
    {
      key: `clip:55:${now - 3600_000}`,
      seq: 55,
      durationMs: 68_000,
      createdAt: now - 3600_000,
      mimeType: 'audio/webm',
      base64,
    },
    {
      key: `clip:56:${now - 1800_000}`,
      seq: 56,
      durationMs: 41_000,
      createdAt: now - 1800_000,
      mimeType: 'audio/webm',
      base64,
    },
  ])

  await startClip(page, '05-clips-bank')

  // 首页 → 我的录音
  await moveAndClick(page, page.getByRole('button', { name: '我的录音' }), 1800)
  await expect(page.getByText('2 段录音')).toBeVisible()
  await expect(page.getByText('只存在这台手机上')).toBeVisible()
  await expect(page.getByText('第 55 题')).toBeVisible()
  await expect(page.getByText('MVCC 如何实现？')).toBeVisible()
  await pause(page, 1400)

  // 回听第一段（真实 webm 音频，点下去真能播）
  await moveAndClick(page, page.getByRole('button', { name: '回听' }).first(), 1800)
  await pause(page, 1600)
  await moveAndClick(page, page.getByRole('button', { name: '停止' }).first(), 700)

  // 返回首页 → 题库管理
  await moveAndClick(page, page.getByRole('button', { name: '返回' }), 1400)
  await expect(page.getByText('下午好')).toBeVisible()
  await moveAndClick(page, page.getByRole('button', { name: '管理' }), 1400)
  await expect(page.getByText('题库管理')).toBeVisible()
  await pause(page, 900)

  // 导出题库 JSON（触发一次真实下载）
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    moveAndClick(page, page.getByRole('button', { name: '导出题库 JSON' }), 200),
  ])
  await expect(page.getByText(`已导出 ${QUESTION_COUNT} 题`)).toBeVisible()
  await pause(page, 1200)

  // 滚到数据库备份段：整库文件连进度和复习记录一起带走
  await scrollTo(page, page.getByText('数据库备份'))
  await expect(page.getByText('导出数据库文件')).toBeVisible()
  await pause(page, 2000)

  // 下载事件兜底消费，避免未处理告警
  await download.path().catch(() => undefined)
})
