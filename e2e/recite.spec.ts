// P3 端到端：背诵模式的真浏览器验证。
//
// 这个 spec 直接用接口播种题库（不走 UI 导入 PDF）—— 上传 33MB 再解析要好几秒，
// 而这里要验的是背诵本身。这样它也就能单独跑，不依赖 import.spec 先跑过。
//
// ⚠️ 它会把题库替换成 12 道 fixture，所以必须排在 import.spec 之后（文件名排序靠后即可）。
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'

const BASE = 'http://127.0.0.1:3100'
const N = 12

const FIXTURE = Array.from({ length: N }, (_, i) => ({
  question: `E2E 第 ${i + 1} 题？请说明一下`,
  answer: `E2E 答案 ${i + 1}`,
}))

function env() {
  const text = fs.readFileSync('.env', 'utf8')
  const get = (k: string) => text.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? ''
  return { account: get('APP_ACCOUNT'), password: get('APP_PASSWORD') }
}

const { account, password } = env()

test.beforeAll(async ({ playwright }) => {
  if (!account || !password) throw new Error('.env 里缺少 APP_ACCOUNT / APP_PASSWORD')
  const api = await playwright.request.newContext({ baseURL: BASE })
  const login = await api.post('/api/login', { data: { account, password } })
  expect(login.ok(), '接口登录失败').toBeTruthy()
  const saved = await api.post('/api/questions', {
    data: { source: 'e2e-recite.json', questions: FIXTURE },
  })
  expect(saved.ok(), '播种题库失败').toBeTruthy()
  await api.dispose()
})

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('账号', { exact: true }).fill(account)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('下午好')).toBeVisible()
}

/** 每个用例都从「干净进度」开始，互不干扰 */
async function resetProgress(page: Page) {
  const res = await page.request.delete('/api/progress')
  expect(res.ok()).toBeTruthy()
}

async function progressOf(page: Page) {
  const res = await page.request.get('/api/progress')
  expect(res.ok()).toBeTruthy()
  return (await res.json()) as { mode: string; posOrder: number; randOrder: number[] }
}

const questionText = (page: Page) => page.locator('[data-testid=recite-card] .t-title-1')

test('顺序背：严格按原序，连续下一题后刷新仍停在同一题', async ({ page }) => {
  await login(page)
  await resetProgress(page)
  await page.goto('/recite')

  await expect(page.getByText(`第 1 / ${N} 题`)).toBeVisible()
  await expect(questionText(page)).toHaveText(FIXTURE[0].question)
  // 题答同屏：答案必须同时可见
  await expect(page.getByText(FIXTURE[0].answer)).toBeVisible()
  // 第一题没有上一题
  await expect(page.getByRole('button', { name: '上一题' })).toBeDisabled()

  await page.getByRole('button', { name: '下一题' }).click()
  await expect(page.getByText(`第 2 / ${N} 题`)).toBeVisible()
  await expect(questionText(page)).toHaveText(FIXTURE[1].question)

  await page.getByRole('button', { name: '下一题' }).click()
  await expect(page.getByText(`第 3 / ${N} 题`)).toBeVisible()
  await expect(questionText(page)).toHaveText(FIXTURE[2].question)

  // 关键：进度在服务端，刷新掉线才算真存住
  await page.reload()
  await expect(page.getByText(`第 3 / ${N} 题`)).toBeVisible({ timeout: 15_000 })
  await expect(questionText(page)).toHaveText(FIXTURE[2].question)
  await expect(page.getByRole('button', { name: '上一题' })).toBeEnabled()
})

test('随机背：确实打乱了顺序，且刷新后仍是同一套随机顺序', async ({ page }) => {
  await login(page)
  await resetProgress(page)
  await page.goto('/recite')
  await expect(page.getByText(`第 1 / ${N} 题`)).toBeVisible()

  await page.getByRole('button', { name: '随机' }).click()
  await expect(page.getByText('已切换为随机')).toBeVisible()

  const prog = await progressOf(page)
  expect(prog.mode).toBe('random')
  expect(prog.posOrder).toBe(0) // 顺序模式的位置没被随机顶掉
  expect(prog.randOrder.slice().sort((a, b) => a - b)).toEqual(
    Array.from({ length: N }, (_, i) => i + 1),
  )
  expect(prog.randOrder, '随机序列与题库原序完全相同，说明没洗牌').not.toEqual(
    Array.from({ length: N }, (_, i) => i + 1),
  )

  const firstRandom = await questionText(page).textContent()

  // 刷新后必须还是同一套随机顺序（不能每次刷新都重洗）
  await page.reload()
  await expect(page.getByText(`第 1 / ${N} 题`)).toBeVisible({ timeout: 15_000 })
  await expect(questionText(page)).toHaveText(firstRandom ?? '')

  // 切回顺序：回到原序第一题
  await page.getByRole('button', { name: '顺序' }).click()
  await expect(page.getByText('已切换为顺序')).toBeVisible()
  await expect(questionText(page)).toHaveText(FIXTURE[0].question)
})

test('换设备：新浏览器上下文登录后进度一致', async ({ page, browser }) => {
  await login(page)
  await resetProgress(page)
  await page.goto('/recite')
  await expect(page.getByText(`第 1 / ${N} 题`)).toBeVisible()
  await page.getByRole('button', { name: '下一题' }).click()
  await page.getByRole('button', { name: '下一题' }).click()
  await expect(page.getByText(`第 3 / ${N} 题`)).toBeVisible()

  // 全新上下文 = 全新设备（没有 Cookie、没有本地存储）
  const other = await browser.newContext({ baseURL: BASE })
  const otherPage = await other.newPage()
  await login(otherPage)
  await otherPage.goto('/recite')
  await expect(otherPage.getByText(`第 3 / ${N} 题`)).toBeVisible({ timeout: 15_000 })
  await expect(questionText(otherPage)).toHaveText(FIXTURE[2].question)
  await other.close()
})

test('背完最后一题：提示这一轮背完了', async ({ page }) => {
  await login(page)
  await resetProgress(page)
  await page.goto('/recite')

  // 直接把进度写到最后一题，省掉 11 次点击。
  // 注意位置语义是「已背题数」：停在最后一题 = 已背 N-1 = 11。
  const put = await page.request.put('/api/progress', { data: { posOrder: N - 1 } })
  expect(put.ok()).toBeTruthy()
  await page.reload()

  await expect(page.getByText(`第 ${N} / ${N} 题`)).toBeVisible({ timeout: 15_000 })
  // 停在最后一题时按钮是「背完了」，点它才是真的背完
  await page.getByRole('button', { name: '背完了' }).click()

  await expect(page.getByText('这一轮背完了')).toBeVisible()
  await expect(page.getByRole('button', { name: '背完了' })).toBeDisabled()
  const prog = await progressOf(page)
  expect(prog.posOrder).toBe(N)
})

test('首页进度卡跟着服务端的进度走', async ({ page }) => {
  await login(page)
  const put = await page.request.put('/api/progress', { data: { posOrder: 5 } })
  expect(put.ok()).toBeTruthy()

  await page.goto('/')
  await expect(page.getByText(`已背 5 / ${N}`)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('上次背到第 6 题')).toBeVisible()
  await expect(page.getByRole('button', { name: '继续背诵' })).toBeVisible()
})
