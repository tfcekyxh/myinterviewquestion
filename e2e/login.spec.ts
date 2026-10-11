// P1 端到端：真浏览器里验证登录、刷新不掉线、登出。
// 用 iPhone 13 视口（390×844）+ Chromium（Playwright 跑不出真 iOS Safari，真机清单另行手动过）。
import { expect, test } from '@playwright/test'
import fs from 'node:fs'

function env() {
  const text = fs.readFileSync('.env', 'utf8')
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
  return { account: get('APP_ACCOUNT'), password: get('APP_PASSWORD') }
}

const { account, password } = env()

test.beforeAll(() => {
  if (!account || !password) throw new Error('.env 里缺少 APP_ACCOUNT / APP_PASSWORD')
})

test('未登录访问首页会被拦到登录页', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('面试题背诵')).toBeVisible()
  await expect(page.getByLabel('账号', { exact: true })).toBeVisible()
})

test('密码错误：显示行内错误，不跳转', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('账号', { exact: true }).fill(account)
  await page.getByLabel('密码', { exact: true }).fill('definitely-wrong')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('alert')).toHaveText('账号或密码不正确')
  await expect(page.getByLabel('账号', { exact: true })).toBeVisible()
})

test('登录成功后刷新页面不掉线', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('账号', { exact: true }).fill(account)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page.getByText('下午好')).toBeVisible()

  // 关键：刷新
  await page.reload()
  await expect(page.getByText('下午好')).toBeVisible()
  // 刷新后仍然认得这个账号 —— 说明服务端的 session 没丢
  await expect(page.getByText(account)).toBeVisible()
})

test('深链接刷新也能保持登录（Express 兜底路由生效）', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('账号', { exact: true }).fill(account)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('下午好')).toBeVisible()

  await page.goto('/recite')
  await page.reload()
  // /recite 目前没有对应路由，会被重定向回首页；若掉线则会回到登录页
  await expect(page.getByText('下午好')).toBeVisible()
})

test('登出后回到登录页，再刷新仍是未登录', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('账号', { exact: true }).fill(account)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('下午好')).toBeVisible()

  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page.getByLabel('账号', { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('账号', { exact: true })).toBeVisible()
})
