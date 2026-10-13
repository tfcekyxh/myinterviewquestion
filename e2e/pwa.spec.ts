// P5：上线收尾的资源与失败兜底。
// 这一组不依赖数据库内容，跑在哪个位置都可以。
import { expect, test } from '@playwright/test'

test('主屏幕相关的资源都在，且类型正确', async ({ page, request }) => {
  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.status()).toBe(200)

  const json = await manifest.json()
  expect(json.name).toBe('面试题背诵')
  expect(json.display).toBe('standalone')
  expect(json.start_url).toBe('/')
  // standalone 下没有浏览器地址栏，图标和主题色就是唯一的外观来源
  const icon = json.icons.find((i: { sizes: string }) => i.sizes === '192x192')
  expect(icon?.src).toBe('/icon-192.png')

  // iOS 加到主屏幕时抓的是这个（且只认 PNG）
  for (const path of ['/icon-180.png', '/icon-192.png', '/icon-512.png']) {
    const res = await request.get(path)
    expect(res.status(), `${path} 应该存在`).toBe(200)
    expect(res.headers()['content-type']).toContain('image/png')
  }

  await page.goto('/')
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icon-180.png')
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
})

test('深链接直接打开（刷新 /review/run）不会 404', async ({ page }) => {
  // 加主屏幕后打开的就是这种地址，Express 的兜底路由必须把它交给前端路由
  const res = await page.goto('/review/run?scope=all&mode=order')
  expect(res?.status()).toBe(200)
  // 没登录，前端应该把人送到登录页而不是白屏
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
})

test('后端不可用时有明确提示，不是白屏', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()

  // 模拟服务挂掉：所有请求直接失败（断网就是这个效果）
  await page.route('**/api/**', (route) => route.abort('failed'))
  await page.reload()

  await expect(page.getByRole('alert')).toContainText('连不上服务器')
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible()
})
