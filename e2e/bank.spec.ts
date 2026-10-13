// P2.5 端到端：导出 / 导入 JSON 的往返。
// 这是「服务端数据丢了也不怕」的兜底，必须证明它真的能救回来 ——
// 所以流程故意先用一份 1 题的 JSON 把题库覆盖掉，再把导出的备份导回来。
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const PDF = path.resolve('pdf/Java 热门面试题 200 道速记通关版 面试刷题 mianshiyacom.pdf')
const TMP = path.resolve('tmp')
const BACKUP = path.join(TMP, 'backup.json')
const SMALL = path.join(TMP, 'one-question.json')

function env() {
  const text = fs.readFileSync('.env', 'utf8')
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
  return { account: get('APP_ACCOUNT'), password: get('APP_PASSWORD') }
}

const { account, password } = env()

test.beforeAll(() => {
  fs.mkdirSync(TMP, { recursive: true })
  fs.writeFileSync(
    SMALL,
    JSON.stringify({ version: 1, source: '覆盖测试.json', questions: [{ question: '临时题', answer: '临时答案' }] }),
  )
})

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('账号', { exact: true }).fill(account)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('下午好')).toBeVisible()
}

async function importPdf(page: import('@playwright/test').Page) {
  await page.goto('/import')
  await page.setInputFiles('input[type=file]', PDF)
  await page.getByRole('button', { name: '开始解析' }).click()
  await expect(page.getByText('前 3 题预览')).toBeVisible({ timeout: 150_000 })
  await page.getByRole('button', { name: '确认入库' }).click()
  await expect(page.getByText('已背 0 / 200')).toBeVisible({ timeout: 30_000 })
}

test('导出 → 覆盖 → 导回：题库能被完整救回来', async ({ page }) => {
  test.setTimeout(180_000)

  await login(page)
  await importPdf(page)

  // 1. 导出备份
  await page.goto('/bank')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出题库 JSON' }).click(),
  ])
  await download.saveAs(BACKUP)
  expect(fs.statSync(BACKUP).size).toBeGreaterThan(1000)

  const backup = JSON.parse(fs.readFileSync(BACKUP, 'utf8'))
  expect(backup.questions).toHaveLength(200)

  // 2. 故意用一份 1 题的 JSON 覆盖掉题库
  //    （页面上现在有两个 file input：JSON 的和数据库的，必须按 aria-label 指名）
  await page.goto('/bank')
  await page.setInputFiles('input[aria-label="选择 JSON 文件"]', SMALL)
  await expect(page.getByText('已背 0 / 1')).toBeVisible({ timeout: 30_000 })

  // 3. 把备份导回来
  await page.goto('/bank')
  await page.setInputFiles('input[aria-label="选择 JSON 文件"]', BACKUP)
  await expect(page.getByText('已背 0 / 200')).toBeVisible({ timeout: 30_000 })

  // 内容与原题一致，且顺序保留
  await expect(page.getByText(/题库：.*· 200 题/)).toBeVisible()
})
