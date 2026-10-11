// 必须在最前面跑：它断言的是「全新数据库」的状态。
// 文件名带 00 前缀是为了排在其它 spec 之前 —— Playwright 按文件路径排序执行，
// 而所有 spec 共用同一个服务、同一个 data/test.db（webServer 启动时会删掉重建）。
// 其余 spec 都不依赖初始状态，顺序无所谓。
import { expect, test } from '@playwright/test'
import fs from 'node:fs'

function env() {
  const text = fs.readFileSync('.env', 'utf8')
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
  return { account: get('APP_ACCOUNT'), password: get('APP_PASSWORD') }
}

const { account, password } = env()

test('全新状态下：首页是空状态，且不会显示题数', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('账号', { exact: true }).fill(account)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page.getByText('下午好')).toBeVisible()
  await expect(page.getByText('还没有题库，点这里导入 PDF')).toBeVisible()
  await expect(page.getByRole('button', { name: '导入题库' })).toBeVisible()
  await expect(page.getByText(/^题库：/)).toHaveCount(0)
})
