// P2 端到端：用真实题库 PDF 在浏览器里跑完整导入链路。
// 这是唯一能证明「浏览器端解析结果与 Node 端一致」的地方 —— 两边共用 parse.ts，
// 但 pdfjs 在浏览器里的文本项与 Node 略有差异，必须在真浏览器里验一次。
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const PDF = path.resolve('pdf/Java 热门面试题 200 道速记通关版 面试刷题 mianshiyacom.pdf')

function env() {
  const text = fs.readFileSync('.env', 'utf8')
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
  return { account: get('APP_ACCOUNT'), password: get('APP_PASSWORD') }
}

const { account, password } = env()

test.beforeAll(() => {
  if (!account || !password) throw new Error('.env 里缺少 APP_ACCOUNT / APP_PASSWORD')
  if (!fs.existsSync(PDF)) throw new Error(`找不到题库 PDF：${PDF}`)
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('账号', { exact: true }).fill(account)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('下午好')).toBeVisible()
}

test('导入真实 PDF：解析出 200 题，入库后首页显示规模', async ({ page }) => {
  test.setTimeout(180_000) // 130 页 + 33MB，慢是正常的

  await login(page)
  // 直接进导入页：这个用例不关心当前有没有题库，两种状态下都要能进
  await page.goto('/import')
  await expect(page.getByText('点击选择 PDF 文件')).toBeVisible()

  await page.setInputFiles('input[type=file]', PDF)
  await expect(page.getByText(/热门面试题 200 道.*\.pdf/)).toBeVisible()

  await page.getByRole('button', { name: '开始解析' }).click()

  // 解析结果页
  await expect(page.getByText('前 3 题预览')).toBeVisible({ timeout: 150_000 })

  // 三个统计：题目 200 / 有答案 200 / 待确认 0
  const metrics = page.locator('.metric')
  await expect(metrics.nth(0).locator('.metric-value')).toHaveText('200')
  await expect(metrics.nth(1).locator('.metric-value')).toHaveText('200')
  await expect(metrics.nth(2).locator('.metric-value')).toHaveText('0')

  // 预览的第一题应与 PDF 原序一致
  await expect(page.getByText('Java 中有哪些集合类？请简单介绍')).toBeVisible()

  await page.getByRole('button', { name: '确认入库' }).click()

  await expect(page.getByText('共 200 题')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/题库：.*· 200 题/)).toBeVisible()
})

test('重新导入会整批替换，不会叠加成 400 题', async ({ page }) => {
  test.setTimeout(180_000)

  await login(page)
  await page.goto('/import')
  await page.setInputFiles('input[type=file]', PDF)
  await page.getByRole('button', { name: '开始解析' }).click()
  await expect(page.getByText('前 3 题预览')).toBeVisible({ timeout: 150_000 })
  await page.getByRole('button', { name: '确认入库' }).click()
  await expect(page.getByText('共 200 题')).toBeVisible({ timeout: 30_000 })
})
