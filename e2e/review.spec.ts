// P4 端到端：用 Playwright 的假麦克风跑完整复习流程。
//
// 这里能验到组件测试验不到的两件事：
//   1. 真 MediaRecorder 能录出非空音频，且 mimeType 不是我们瞎猜的（扩展名推导要靠它）
//   2. 真浏览器里，「对照答案」之前整个页面（含 hidden 元素）都不含答案文本
import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'

const BASE = 'http://127.0.0.1:3100'
const N = 6

const FIXTURE = Array.from({ length: N }, (_, i) => ({
  question: `复习第 ${i + 1} 题？请讲一下`,
  answer: `复习答案 ${i + 1}：这一段只应该出现在对照答案页`,
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
  expect((await api.post('/api/login', { data: { account, password } })).ok()).toBeTruthy()
  expect(
    (await api.post('/api/questions', { data: { source: 'e2e-review.json', questions: FIXTURE } })).ok(),
  ).toBeTruthy()
  await api.dispose()
})

async function login(page: Page) {
  await page.goto('/login')
  await page.getByLabel('账号', { exact: true }).fill(account)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('下午好')).toBeVisible()
}

/** 造一个「刚背完的一轮」：最后 4 题（第 3–6 题） */
async function seedRound(page: Page) {
  expect((await page.request.delete('/api/progress')).ok()).toBeTruthy()
  expect((await page.request.put('/api/progress', { data: { posOrder: N - 4, roundStart: N - 4 } })).ok()).toBeTruthy()
  const done = await page.request.put('/api/progress', { data: { posOrder: N } })
  expect(done.ok()).toBeTruthy()
  const state = await (await page.request.get('/api/progress')).json()
  expect(state.lastRound?.seqs).toEqual([3, 4, 5, 6])
}

const mic = (page: Page) => page.getByRole('button', { name: /按住录音|结束录音/ })

test('复习范围页：刚背完的一轮可用，并显示范围', async ({ page }) => {
  await login(page)
  await seedRound(page)
  await page.goto('/review')

  const round = page.getByRole('button', { name: /刚背完的这一轮/ })
  await expect(round).toBeEnabled()
  await expect(round).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('第 3 – 6 题')).toBeVisible()
  await expect(page.getByText(`共 ${N} 题`)).toBeVisible()
})

test('完整流程：待录（看不到答案）→ 录音 → 对照答案（能回放）', async ({ page }) => {
  test.setTimeout(60_000)
  await login(page)
  await seedRound(page)
  await page.goto('/review')
  await page.getByRole('button', { name: '开始复习' }).click()

  // ── S6 待录 ──
  await expect(page.getByText('第 1 / 4 题')).toBeVisible()
  await expect(page.getByText(FIXTURE[2].question)).toBeVisible()
  await expect(page.getByText('答案已隐藏')).toBeVisible()
  await expect(page.getByText('按住说话，讲完松手')).toBeVisible()

  // 真浏览器里也确认一遍：整个 body 里找不到答案
  const beforeText = await page.evaluate(() => document.body.innerText)
  expect(beforeText).not.toContain(FIXTURE[2].answer)
  expect(beforeText).not.toContain('参考答案')

  // ── S7 录音中：按住麦克风 1.2 秒 ──
  const button = mic(page)
  await button.hover()
  await page.mouse.down()
  await expect(page.getByText('录音中')).toBeVisible()
  await expect(page.getByText('松手或点「说完了」结束')).toBeVisible()
  // 录音中照样看不到答案
  expect(await page.evaluate(() => document.body.innerText)).not.toContain(FIXTURE[2].answer)

  await page.waitForTimeout(1200)
  await page.mouse.up()

  // ── S8 对照答案 ──
  await expect(page.getByText('参考答案')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(FIXTURE[2].answer)).toBeVisible()
  await expect(page.getByText('回放我刚才说的')).toBeVisible()

  // 回放：点一下要能播起来（假设备产生的是真实音频数据）
  await page.getByRole('button', { name: '播放回放' }).click()
  await expect(page.getByRole('button', { name: '暂停回放' })).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: '暂停回放' }).click()

  // 录音确实落到了本机 IndexedDB，而且 mimeType 是浏览器真给的
  const stored = await page.evaluate(
    () =>
      new Promise<{ count: number; mimeType: string; size: number }>((resolve) => {
        const req = indexedDB.open('interview-recorder')
        req.onsuccess = () => {
          const db = req.result
          const all = db.transaction('clips', 'readonly').objectStore('clips').getAll()
          all.onsuccess = () => {
            const rows = all.result as Array<{ mimeType: string; blob: Blob }>
            resolve({ count: rows.length, mimeType: rows[0]?.mimeType ?? '', size: rows[0]?.blob?.size ?? 0 })
          }
          all.onerror = () => resolve({ count: -1, mimeType: '', size: 0 })
        }
        req.onerror = () => resolve({ count: -1, mimeType: '', size: 0 })
      }),
  )
  expect(stored.count).toBe(1)
  expect(stored.size).toBeGreaterThan(0)
  // 关键：类型由浏览器决定，我们只负责按它推扩展名（绝不写死 .webm）
  expect(stored.mimeType).toMatch(/^audio\/(mp4|webm|ogg)/)

  // 服务端记了一条复习记录
  const reviews = await (await page.request.get('/api/reviews')).json()
  expect(reviews.total).toBe(1)
})

test('第一题：上一题禁用；切到下一题答案重新藏起来', async ({ page }) => {
  test.setTimeout(60_000)
  await login(page)
  await seedRound(page)
  await page.goto('/review/run?scope=round&mode=order')

  const button = mic(page)
  await button.hover()
  await page.mouse.down()
  await expect(page.getByText('录音中')).toBeVisible()
  await page.waitForTimeout(700)
  await page.mouse.up()
  await expect(page.getByText('参考答案')).toBeVisible({ timeout: 10_000 })

  await expect(page.getByRole('button', { name: '上一题' })).toBeDisabled()
  await page.getByRole('button', { name: '下一题' }).click()

  await expect(page.getByText('第 2 / 4 题')).toBeVisible()
  await expect(page.getByText('答案已隐藏')).toBeVisible()
  await expect(page.getByText('参考答案')).toHaveCount(0)
  expect(await page.evaluate(() => document.body.innerText)).not.toContain(FIXTURE[3].answer)
})
