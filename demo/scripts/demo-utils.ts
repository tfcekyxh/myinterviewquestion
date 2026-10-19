import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { SILENT_MP3_PATH, RAW_DIR, VIEWPORT } from './constants'

/**
 * 录制期专用的交互工具（移动端版，改写自 jplearn/myresume 的 demo-utils）。
 *
 * 与 e2e 的分工：那里是「跑断言」，这里是「让观感可读」——
 * 触摸点要真的滑过去、动作之间要留停顿、中间态要被放大到看得清。
 * 本项目移动优先，用「手指触点」而不是桌面箭头光标。
 */

/** 固定停顿，给观众看画面的时间。 */
export function pause(page: Page, ms: number) {
  return page.waitForTimeout(ms)
}

// ---------------------------------------------------------------------------
// 录制开关
// ---------------------------------------------------------------------------

/** page → 片段 id，用来在 stop 时知道该报哪个文件。 */
const recording = new Map<Page, string>()

/**
 * 开始录这条片段。
 *
 * 用 page.screencast 显式开关，而不是配置里的 use.video：后者从 context
 * 建好就开始录，准备步骤与开场白屏都会进视频；而且它给每个动作加的
 * 展示高亮会在录制时引入明显延迟（一次 mouse.up 就要几百毫秒）。
 */
export async function startClip(page: Page, clipId: string) {
  await mkdir(RAW_DIR, { recursive: true })
  await page.screencast.start({
    path: resolve(RAW_DIR, `${clipId}.webm`),
    size: VIEWPORT,
  })
  recording.set(page, clipId)
}

/** 停止录制并落盘。没在录的话是空操作，用例中途失败也能靠它保住视频。 */
export async function stopClip(page: Page) {
  const clipId = recording.get(page)
  if (!clipId) return
  recording.delete(page)
  await page.screencast.stop()
  console.log(`[demo] 已录到 ${resolve(RAW_DIR, `${clipId}.webm`)}`)
}

// ---------------------------------------------------------------------------
// 自绘触摸点
// ---------------------------------------------------------------------------

/**
 * 自绘触摸点层。
 *
 * Playwright 录的是页面像素，本来没有系统触点，所以自己画一层：
 * 监听真实 mousemove / mousedown 更新位置、按压缩放与点击涟漪。
 * 不用 screencast.showActions 的内建光标：它按「动作点」动画，
 * 而演示里大量操作是裸 mouse 事件（长按录音、滑动翻卡），不会跟随。
 *
 * 整层 pointer-events: none，否则会吃掉点击。函数体里不能引用外部变量
 * （addInitScript 是序列化后注入的），所以只能自包含。
 */
function touchOverlay() {
  const marker = window as unknown as { __demoTouchInstalled?: boolean }
  if (marker.__demoTouchInstalled) return
  marker.__demoTouchInstalled = true

  const host = document.createElement('div')
  host.id = '__demo-touch-layer'
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;pointer-events:none;overflow:hidden;contain:strict'

  // 触点：44px 圆（贴合移动端 44pt 最小点击目标的视觉印象），圆心即点击点
  const dot = document.createElement('div')
  dot.style.cssText =
    'position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;' +
    'border-radius:50%;opacity:0;pointer-events:none;will-change:transform;' +
    'background:rgba(37,99,235,.22);border:2px solid rgba(37,99,235,.85);' +
    'box-sizing:border-box;transition:transform 300ms linear,opacity 150ms linear'

  const ring = document.createElement('div')
  ring.style.cssText =
    'position:absolute;left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;' +
    'border:3px solid rgba(37,99,235,.8);border-radius:50%;opacity:0;pointer-events:none'

  const style = document.createElement('style')
  style.textContent =
    '@keyframes demo-ripple{from{width:44px;height:44px;margin:-22px 0 0 -22px;opacity:.85}' +
    'to{width:92px;height:92px;margin:-46px 0 0 -46px;opacity:0}}'

  host.append(style, ring, dot)
  // addInitScript 在 document-start 就跑了，那时 document.body 还不存在，
  // 直接挂会静默失败（整层触点就没了），必须等 DOM 建好
  const attach = () => document.body?.appendChild(host)
  if (document.body) attach()
  else document.addEventListener('DOMContentLoaded', attach, { once: true })

  const place = (x: number, y: number, scale: number) => {
    dot.style.opacity = '1'
    dot.style.transform = `translate3d(${x}px,${y}px,0) scale(${scale})`
    ring.style.left = `${x}px`
    ring.style.top = `${y}px`
  }

  window.addEventListener('mousemove', (e) => place(e.clientX, e.clientY, 1), {
    capture: true,
    passive: true,
  })

  window.addEventListener(
    'mousedown',
    (e) => {
      place(e.clientX, e.clientY, 0.82)
      // 重启动画：先置 none 再强制读一次 offsetWidth
      ring.style.animation = 'none'
      void ring.offsetWidth
      ring.style.animation = 'demo-ripple 420ms ease-out'
    },
    { capture: true, passive: true },
  )

  window.addEventListener('mouseup', (e) => place(e.clientX, e.clientY, 1), {
    capture: true,
    passive: true,
  })
}

/** 每条片段的起手式：装上自绘触点层。 */
export async function prepareClip(context: BrowserContext) {
  await context.addInitScript(touchOverlay)
}

// ---------------------------------------------------------------------------
// 触摸操作
// ---------------------------------------------------------------------------

/** 平滑滚动到元素（页面很长，瞬时跳转在动图里看着很晕）。 */
export async function scrollTo(page: Page, target: Locator, afterMs = 550) {
  await target.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  await pause(page, afterMs)
}

/** 平滑滚回页面顶部。 */
export async function scrollToTop(page: Page, afterMs = 800) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  await pause(page, afterMs)
}

/** 把触点滑到元素中心并停顿，让观众看清要操作哪里。返回元素位置。 */
export async function moveTo(page: Page, target: Locator, settleMs = 260) {
  const box = await target.boundingBox()
  if (!box) throw new Error('目标不可见，拿不到 boundingBox')

  // 不在视口内就先平滑滚过去：mouse.move 用的是视口坐标，
  // 滚都没滚就直接移过去，点不到东西
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  const inView = box.y >= 0 && box.y + box.height <= viewport.height
  if (!inView) {
    await scrollTo(page, target)
  }

  // 步数刻意压得少：每步都是一次 CDP 往返，20 步要近一秒，
  // 而位移有 CSS 过渡补间，6 步看起来一样顺。
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 })
  await pause(page, settleMs)
  return box
}

/**
 * 滑过去 → 停顿 → 按下抬起。
 *
 * 演示里所有点击都必须走这里：直接 locator.click() 只派发一次跳跃式的
 * mousemove，自绘触点会瞬移而不是滑过去。
 */
export async function moveAndClick(page: Page, target: Locator, afterMs = 500) {
  await moveTo(page, target)
  await page.mouse.down()
  await pause(page, 60)
  await page.mouse.up()
  await pause(page, afterMs)
}

/** 先清空再逐字输入，制造「在打字」的观感（只用于短字段）。 */
export async function typeSlowly(
  page: Page,
  target: Locator,
  text: string,
  delay = 70,
  afterMs = 300,
) {
  await moveAndClick(page, target, 150)
  await target.fill('')
  await target.pressSequentially(text, { delay })
  await pause(page, afterMs)
}

/**
 * 长按：滑过去 → 按下 → 保持 → 抬起。
 * 复习页的「按住录音」按钮靠 pointerdown/pointerup 驱动，必须用裸鼠标事件。
 */
export async function moveAndHold(page: Page, target: Locator, holdMs: number, afterMs = 600) {
  await moveTo(page, target)
  await page.mouse.down()
  await pause(page, holdMs)
  await page.mouse.up()
  await pause(page, afterMs)
}

// ---------------------------------------------------------------------------
// 接口 mock：AI 重点与云端朗读音频
// ---------------------------------------------------------------------------

/** 各题的「AI 回答重点」mock 文案。只覆盖片段里真会出现的题号，其余走兜底。 */
const KEY_POINTS: Record<number, string[]> = {
  1: [
    '先答整体结构：数组 + 链表 + 红黑树',
    '树化条件：链表超 8 且数组超 64，退化阈值是 6',
    '顺带提负载因子 0.75 与扩容时的重新哈希',
  ],
  2: [
    '核心：扩容丢数据 + JDK 7 头插死循环',
    '结论落到并发场景换 ConcurrentHashMap',
    '可补充 put 竞态导致 size 统计不准',
  ],
  3: [
    '分版本答：JDK 7 分段锁，JDK 8 CAS + synchronized',
    '强调读操作基本无锁，这是它快的原因',
    'size 与 sum 用了分散计算，别和 HashMap 混',
  ],
  4: [
    '一句话：一个是 JVM 关键字，一个是 API',
    'ReentrantLock 的差异点：可中断、可公平、可限时',
    '提一把 synchronized 的锁升级作对比',
  ],
  55: [
    '三件套：隐式版本列、undo 版本链、ReadView',
    '快照读靠可见性判断，读写互不阻塞',
    '当前读仍走锁；可重复读下首次 ReadView 定快照',
  ],
  56: [
    '间隙锁锁的是记录间的开区间，防止插入幻读',
    '与 next-key lock 配合，在可重复读级别生效',
    '代价是锁范围扩大易死锁，事务宜短',
  ],
}

const KEY_POINTS_FALLBACK = [
  '先给一句话结论，再展开两三个支撑点',
  '结合业务场景说落地，别只背定义',
  '主动提及局限与替代方案，体现深度',
]

function pointsFor(seq: number): string[] {
  return KEY_POINTS[seq] ?? KEY_POINTS_FALLBACK
}

/**
 * mock「AI 回答重点」接口。
 *
 * 严禁打真实 GLM：免费档按分钟限流，翻卡节奏稍快就会 502 刷屏。
 * 延迟放大到 2.6s —— 演示脚本从移动到点击有约 1s 的观感停顿，
 * 延迟太短的话「AI 正在总结重点…」这个中间态根本录不到。
 */
export async function mockKeyPoints(page: Page, delayMs = 2600) {
  await page.route('**/api/keypoints/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const m = url.pathname.match(/\/api\/keypoints\/(\d+)(?:\/regenerate)?$/)
    const seq = m ? Number(m[1]) : 1

    if (req.method() === 'PUT') {
      // 用户编辑保存：原样回显，source 标记为「我改过」
      const body = req.postDataJSON() as { points?: unknown }
      const points = Array.isArray(body?.points) ? body.points.map(String) : []
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ seq, points, source: 'user', updatedAt: Date.now() }),
      })
      return
    }

    await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ seq, points: pointsFor(seq), source: 'ai', updatedAt: Date.now() }),
    })
  })
}

/**
 * mock「云端朗读音频」接口。
 *
 * 服务端真生成要调微软 TTS（1-2 秒/段，还可能失败），演示里用一段
 * 静音 MP3 顶替 —— <audio> 拿到的是真音频文件，播放与「云端音质」
 * 指示灯的链路与线上完全一致，只是没有声音。
 */
export async function mockTts(page: Page, delayMs = 350) {
  const mp3 = await readFile(SILENT_MP3_PATH)
  await page.route('**/api/tts/**', async (route) => {
    await new Promise((r) => setTimeout(r, delayMs))
    await route.fulfill({ status: 200, contentType: 'audio/mpeg', body: mp3 })
  })
}

// ---------------------------------------------------------------------------
// 本机录音（IndexedDB）播种
// ---------------------------------------------------------------------------

/**
 * 往 IndexedDB 的 clips store 里塞几段假录音。
 *
 * 录音只存本机，而 Playwright 每条 test 都是全新 context（IndexedDB 不跨
 * 片段共享），所以片段 5 要自己造数据。blob 用真实 webm 音频，「回听」
 * 按钮点下去真能播。
 *
 * store 结构与 web/src/lib/audioStore.ts 对齐：keyPath 'key'。
 */
export async function seedIndexedDBClips(
  page: Page,
  clips: Array<{ key: string; seq: number; durationMs: number; createdAt: number; mimeType: string; base64: string }>,
) {
  await page.evaluate(async (rows) => {
    const open = () =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open('interview-recorder', 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('clips')) db.createObjectStore('clips', { keyPath: 'key' })
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    const db = await open()
    const tx = db.transaction('clips', 'readwrite')
    const store = tx.objectStore('clips')
    for (const row of rows) {
      const bin = Uint8Array.from(atob(row.base64), (c) => c.charCodeAt(0))
      store.put({
        key: row.key,
        blob: new Blob([bin], { type: row.mimeType }),
        mimeType: row.mimeType,
        durationMs: row.durationMs,
        createdAt: row.createdAt,
        seq: row.seq,
      })
    }
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
    db.close()
  }, clips)
}
