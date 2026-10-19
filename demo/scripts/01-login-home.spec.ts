import { expect, test } from './fixtures'
import { DEMO_ACCOUNT, DEMO_PASSWORD, QUESTION_COUNT } from './constants'
import { moveAndClick, pause, prepareClip, startClip, typeSlowly } from './demo-utils'

/**
 * 片段 1：登录 → 首页。
 *
 * 演示登录表单与首页进度卡（已背 18/60、进度条、题库信息）。
 * 这条片段刻意不用 storageState —— 免登录状态会让第一帧直接就是首页，
 * 登录过程就没了。种子进度见 seed-demo.ts。
 */

// 清掉免登录 cookie，从登录页开场
test.use({ storageState: { cookies: [], origins: [] } })

test('01-login-home：登录 → 首页进度卡', async ({ page, context }) => {
  await prepareClip(context)

  await page.goto('/login')
  await expect(page.getByText('面试题背诵')).toBeVisible()
  await pause(page, 700)

  await startClip(page, '01-login-home')

  // 账号逐字敲，密码直接填（演示动图里不该一个字符一个字符地暴露密码）
  await typeSlowly(page, page.getByLabel('账号', { exact: true }), DEMO_ACCOUNT)
  await moveAndClick(page, page.getByLabel('密码', { exact: true }), 200)
  await page.getByLabel('密码', { exact: true }).fill(DEMO_PASSWORD)
  await pause(page, 500)
  await moveAndClick(page, page.getByRole('button', { name: '登录' }), 1800)

  // 首页：进度卡
  await expect(page.getByText('下午好')).toBeVisible()
  await expect(page.getByText(`已背 18 / ${QUESTION_COUNT}`)).toBeVisible()
  await expect(page.getByText('上次背到第 19 题')).toBeVisible()
  await pause(page, 1400)

  // 题库信息行（来源 + 规模 + 管理入口）
  await expect(page.getByText(new RegExp(`题库：.*${QUESTION_COUNT} 题`))).toBeVisible()
  await pause(page, 1000)

  // 三个入口按钮都在首页
  await expect(page.getByRole('button', { name: '继续背诵' })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始复习' })).toBeVisible()
  await expect(page.getByRole('button', { name: '我的录音' })).toBeVisible()
  await pause(page, 1200)
})
