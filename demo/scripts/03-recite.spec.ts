import { expect, test } from './fixtures'
import { QUESTION_COUNT } from './constants'
import {
  moveAndClick,
  mockKeyPoints,
  mockTts,
  pause,
  prepareClip,
  scrollTo,
  scrollToTop,
  startClip,
} from './demo-utils'

/**
 * 片段 3：背诵页。
 *
 * 顺序即叙事：进页面第一张卡就开始生成 AI 重点（mock 延迟 2.6s，
 * 「AI 正在总结重点…」的中间态才录得到）→ 翻卡 → 随机/顺序切换 →
 * 自动阅读（mock 云端音频，「云端音质」指示灯）→ 刷新后进度不丢。
 */

test('03-recite：翻卡 · AI 重点 · 自动阅读', async ({ page, context }) => {
  await prepareClip(context)
  // 两个 AI 能力全部 mock：真实 GLM 免费档按分钟限流，翻卡稍快就 502
  await mockKeyPoints(page)
  await mockTts(page)

  await page.goto('/')
  await expect(page.getByText('下午好')).toBeVisible()

  await startClip(page, '03-recite')

  // 导入后进度归零，首页主按钮是「开始背诵」
  await moveAndClick(page, page.getByRole('button', { name: '开始背诵' }), 1200)

  // 第 1 题：题干与答案同屏（防抖 600ms 后开始生成重点，mock 2.6s 返回）
  await expect(page.getByText(`第 1 / ${QUESTION_COUNT} 题`)).toBeVisible()
  await expect(page.getByText('AI 正在总结重点…')).toBeVisible()
  await expect(page.locator('.keypoints-list li').first()).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('AI 生成')).toBeVisible()
  await scrollTo(page, page.locator('.keypoints-list li').first())
  await pause(page, 2000)

  // 连翻两张
  await scrollToTop(page)
  await moveAndClick(page, page.getByRole('button', { name: '下一题' }), 900)
  await expect(page.getByText(`第 2 / ${QUESTION_COUNT} 题`)).toBeVisible()
  await moveAndClick(page, page.getByRole('button', { name: '下一题' }), 1200)
  await expect(page.getByText(`第 3 / ${QUESTION_COUNT} 题`)).toBeVisible()
  await pause(page, 900)

  // 随机 / 顺序切换（toast 提示；随机确实换了题，顺序又回到原序）
  await moveAndClick(page, page.getByRole('button', { name: '随机', exact: true }), 1100)
  await expect(page.getByText('已切换为随机')).toBeVisible()
  await pause(page, 1400)
  await moveAndClick(page, page.getByRole('button', { name: '顺序', exact: true }), 1100)
  await expect(page.getByText('已切换为顺序')).toBeVisible()
  await pause(page, 900)

  // 自动阅读：点开关的同一时刻就开播，指示灯显示音源。
  // ⚠️ 这个 chip 带 role="switch"（aria-checked），不是 button 角色
  await moveAndClick(page, page.getByRole('switch', { name: '自动阅读' }), 800)
  await expect(page.getByText('云端音质')).toBeVisible()
  await pause(page, 2800)

  // 翻到下一题接着念；先关掉开关，免得刷新后的开关态让画面分心
  await moveAndClick(page, page.getByRole('button', { name: '下一题' }), 1400)
  await expect(page.getByText(`第 4 / ${QUESTION_COUNT} 题`)).toBeVisible()
  await moveAndClick(page, page.getByRole('switch', { name: '✓ 自动阅读' }), 800)
  await expect(page.getByText('云端音质')).toHaveCount(0)

  // 刷新：进度在服务端，掉线才算真存住
  await page.reload()
  await expect(page.getByText(`第 4 / ${QUESTION_COUNT} 题`)).toBeVisible({ timeout: 15_000 })
  await pause(page, 2000)
})
