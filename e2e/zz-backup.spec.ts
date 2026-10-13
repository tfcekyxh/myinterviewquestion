// 整库导出 / 还原的端到端往返。
//
// 文件名带 zz 前缀是为了**排在最后**：还原会把服务端那个 SQLite 文件整个换掉，
// 跑在别人前面会把别的 spec 依赖的数据搅乱。
// 它证明的是「服务端数据真丢了也能救回来」—— 而且连进度一起救回来。
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const PDF = path.resolve('pdf/Java 热门面试题 200 道速记通关版 面试刷题 mianshiyacom.pdf')
const TMP = path.resolve('tmp')
const DUMP = path.join(TMP, 'backup.db')
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

test('导出数据库文件 → 毁掉数据 → 还原：题目与进度一起回来，且不掉线', async ({ page }) => {
  test.setTimeout(180_000)

  await login(page)
  await importPdf(page)

  // 先背几题，让备份里带上进度 —— 不然「连进度一起救回来」就没被验到
  await page.goto('/recite')
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '下一题' }).click()
  await expect(page.getByText('第 4 / 200 题')).toBeVisible()
  await page.goto('/')
  await expect(page.getByText('已背 3 / 200')).toBeVisible()

  // 1. 导出整库文件
  await page.goto('/bank')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出数据库文件' }).click(),
  ])
  await download.saveAs(DUMP)
  expect(fs.statSync(DUMP).size).toBeGreaterThan(4096)
  // 真的是 SQLite 文件，不是一张错误页
  expect(fs.readFileSync(DUMP).subarray(0, 15).toString('latin1')).toBe('SQLite format 3')

  // 2. 毁掉数据：换成 1 题
  await page.goto('/bank')
  await page.setInputFiles('input[aria-label="选择 JSON 文件"]', SMALL)
  await expect(page.getByText('已背 0 / 1')).toBeVisible({ timeout: 30_000 })

  // 3. 用整库文件还原（要过二次确认）
  await page.goto('/bank')
  await page.setInputFiles('input[aria-label="选择数据库文件"]', DUMP)
  await expect(page.getByText(/确定用「.*」覆盖当前数据吗/)).toBeVisible()
  await page.getByRole('button', { name: '确定覆盖' }).click()
  await expect(page.getByText('已还原，题库共 200 题')).toBeVisible({ timeout: 30_000 })

  // 4. 题目、进度都在，而且还在登录状态（还原不该把人踢下线）
  await page.goto('/')
  await expect(page.getByText('已背 3 / 200')).toBeVisible()
  await expect(page.getByText(/题库：.*· 200 题/)).toBeVisible()
})

test('拿一个不是数据库的文件去还原：被挡住，题库不动', async ({ page }) => {
  const junk = path.join(TMP, 'junk.db')
  fs.writeFileSync(junk, '这不是数据库，只是一段文字。'.repeat(100))

  await login(page)
  await page.goto('/bank')
  // 坏文件在选完的那一刻就被服务端拒了（后端先验文件再动数据）
  await page.setInputFiles('input[aria-label="选择数据库文件"]', junk)
  await page.getByRole('button', { name: '确定覆盖' }).click()
  await expect(page.getByRole('alert')).toContainText('不是')

  await page.goto('/')
  await expect(page.getByText(/题库：.*· 200 题/)).toBeVisible()
})
