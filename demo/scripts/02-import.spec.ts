import { expect, test } from './fixtures'
import { DEMO_PDF_PATH, QUESTION_COUNT } from './constants'
import { moveAndClick, pause, prepareClip, scrollTo, startClip } from './demo-utils'

/**
 * 片段 2：PDF 导入题库。
 *
 * 首页 → 题库管理 → 重新导入 PDF → 选文件 → 解析（字号台阶切题）→
 * 核对统计与前 3 题预览 → 确认入库 → 回首页。
 *
 * 素材是 gen-demo-pdf.mjs 现画的演示 PDF（4 页 60 题），解析规则与
 * 真实题库完全一致。导入后进度归零是产品行为（换题库旧进度作废）。
 */

test('02-import：PDF 导入全流程', async ({ page, context }) => {
  await prepareClip(context)

  await page.goto('/')
  await expect(page.getByText('下午好')).toBeVisible()

  await startClip(page, '02-import')

  // 首页 → 题库管理 → 重新导入 PDF
  await moveAndClick(page, page.getByRole('button', { name: '管理' }), 1400)
  await expect(page.getByText('题库管理')).toBeVisible()
  await pause(page, 900)
  await moveAndClick(page, page.getByRole('button', { name: '重新导入 PDF' }), 1400)
  await expect(page.getByText('点击选择 PDF 文件')).toBeVisible()
  await pause(page, 700)

  // 选文件：filechooser 事件拦截，不会弹出原生对话框
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    moveAndClick(page, page.getByRole('button', { name: /点击选择 PDF 文件/ }), 300),
  ])
  await chooser.setFiles(DEMO_PDF_PATH)
  await expect(page.getByText(/Java 面试题速记 60 题（演示）\.pdf/)).toBeVisible()
  await pause(page, 900)

  // 开始解析 → 解析中 → 解析完成
  await moveAndClick(page, page.getByRole('button', { name: '开始解析' }), 500)
  await expect(page.getByText('前 3 题预览')).toBeVisible({ timeout: 120_000 })

  // 三个统计：题目 60 / 有答案 60 / 待确认 0
  const metrics = page.locator('.metric')
  await expect(metrics.nth(0).locator('.metric-value')).toHaveText(String(QUESTION_COUNT))
  await expect(metrics.nth(1).locator('.metric-value')).toHaveText(String(QUESTION_COUNT))
  await expect(metrics.nth(2).locator('.metric-value')).toHaveText('0')
  await pause(page, 1500)

  // 前 3 题预览滚出来看
  await scrollTo(page, page.getByText('前 3 题预览'))
  await expect(page.getByText('HashMap 底层结构是什么？')).toBeVisible()
  await pause(page, 1600)

  // 确认入库 → 回首页（进度归零，从第 1 题开始）
  await moveAndClick(page, page.getByRole('button', { name: '确认入库' }), 2000)
  await expect(page.getByText('下午好')).toBeVisible()
  await expect(page.getByText('还没开始，从第 1 题开始')).toBeVisible()
  await expect(page.getByText(new RegExp(`题库：.*${QUESTION_COUNT} 题`))).toBeVisible()
  await pause(page, 1800)
})
