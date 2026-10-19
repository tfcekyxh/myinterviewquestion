import { expect, test } from './fixtures'
import { mockKeyPoints, mockTts, moveAndClick, moveTo, pause, prepareClip, scrollTo, startClip } from './demo-utils'

/**
 * 片段 4：复习（开口讲 → 对照答案）。
 *
 * 先通过接口造一个「刚背完的一轮」（第 55-60 题），再走完整流程：
 * 范围页 → 待录（答案根本不进 DOM）→ 按住麦克风录音（假设备出真实音频）
 * → 松手对照答案（参考答案 + 回放 + AI 重点）→ 下一题答案重新藏起来。
 */

test('04-review：开口讲 · 对照答案 · 回放', async ({ page, context }) => {
  await prepareClip(context)
  await mockKeyPoints(page)
  await mockTts(page)

  // 造「刚背完的一轮」：第 55-60 题。位置语义是「已背题数」：
  // 从 54 起、背到 60，这一轮就是 55-60
  await page.goto('/')
  await expect(page.getByText('下午好')).toBeVisible()
  await page.request.delete('/api/progress')
  await page.request.put('/api/progress', { data: { posOrder: 54, roundStart: 54 } })
  await page.request.put('/api/progress', { data: { posOrder: 60 } })

  await startClip(page, '04-review')

  // 首页 → 开始复习 → 范围页（默认选中「刚背完的这一轮」）
  await moveAndClick(page, page.getByRole('button', { name: '开始复习' }), 1800)
  await expect(page.getByText('答案会先藏起来，请对着题目开口讲一遍并录音')).toBeVisible()
  const roundCard = page.getByRole('button', { name: /刚背完的这一轮/ })
  await expect(roundCard).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('第 55 – 60 题')).toBeVisible()
  await pause(page, 1500)

  await moveAndClick(page, page.getByRole('button', { name: '开始复习' }), 1800)

  // S6 待录：只有题干，「答案已隐藏」占位
  await expect(page.getByText('第 1 / 6 题')).toBeVisible()
  await expect(page.getByText('MVCC 如何实现？')).toBeVisible()
  await expect(page.getByText('答案已隐藏')).toBeVisible()
  await pause(page, 1800)

  // S7 按住录音：裸鼠标事件驱动（按钮认 pointerdown/pointerup），保持 4s。
  // 录长一点：回放那段要从容点到「暂停」，2.5s 的录音余量太紧
  const mic = page.getByRole('button', { name: '按住录音' })
  await moveTo(page, mic)
  await page.mouse.down()
  await expect(page.getByText('录音中')).toBeVisible()
  await expect(page.getByText('松手或点「说完了」结束')).toBeVisible()
  await pause(page, 4000)
  await page.mouse.up()
  await pause(page, 900)

  // S8 对照答案：参考答案 + 回放条 + AI 重点（对照阶段才加载）
  await expect(page.getByText('参考答案')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('三件套：隐式版本列、undo 版本链、ReadView。')).toBeVisible()
  await expect(page.getByText('回放我刚才说的')).toBeVisible()
  await pause(page, 1400)

  // 回放刚才讲的
  await moveAndClick(page, page.getByRole('button', { name: '播放回放' }), 1600)
  await expect(page.getByRole('button', { name: '暂停回放' })).toBeVisible()
  await moveAndClick(page, page.getByRole('button', { name: '暂停回放' }), 700)

  // AI 重点（mock 1.3s）
  await expect(page.locator('.keypoints-list li').first()).toBeVisible({ timeout: 10_000 })
  await scrollTo(page, page.locator('.keypoints-list li').first())
  await pause(page, 1800)

  // 下一题：答案重新藏起来 —— 复习页的核心红线
  await moveAndClick(page, page.getByRole('button', { name: '下一题' }), 1400)
  await expect(page.getByText('第 2 / 6 题')).toBeVisible()
  await expect(page.getByText('答案已隐藏')).toBeVisible()
  await expect(page.getByText('参考答案')).toHaveCount(0)
  await pause(page, 1800)
})
