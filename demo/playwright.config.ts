import { defineConfig, devices } from '@playwright/test'
import { AUTH_STATE_PATH, BASE_URL, DEMO_ACCOUNT, DEMO_DB_PATH, DEMO_PASSWORD, PORT, VIEWPORT } from './scripts/constants'

/**
 * 演示录制的独立配置。
 *
 * 与 e2e 彻底隔离：testDir 是 demo/scripts，根配置是 ./e2e，
 * 所以 `npm run test:e2e` 永远看不到这些用例。
 *
 * 一个 test = 一个 context = 一条 webm，五个片段天然就是五个独立文件。
 */
export default defineConfig({
  testDir: './scripts',
  // 注意：不能把 outputDir 指到 RAW_DIR —— Playwright 每次启动会清空
  // outputDir，分条补录时会把之前录好的 webm 一起删掉。失败产物走默认
  // test-results/（根 .gitignore 已覆盖），webm 单独存 demo/output/raw。
  globalSetup: './scripts/seed-demo.ts',

  // 片段之间共用同一份服务端数据（按 01→05 顺序演进），必须串行
  workers: 1,
  fullyParallel: false,
  // 重试会再录一份视频、多打一次接口，故不重试
  retries: 0,
  // 片段 2 要真解析 PDF（pdfjs 逐页抽文本），给足时间
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: 'list',

  use: {
    baseURL: BASE_URL,
    // 免登录：session 存在数据库里，cookie 存在 storageState 文件里。
    // 片段 2-5 直接用这份 state 开场，视频第一帧就是页面加载而不是登录页。
    storageState: AUTH_STATE_PATH,
    // 这两个尺寸必须一致，否则录出来的画面会被缩放、文字发虚
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    // 这里刻意不配 use.video：录制改由各条 spec 用 page.screencast 显式开关
    // （见 demo-utils 的 startClip），这样准备步骤与开场白屏不会进视频，
    // 也避开了 use.video 给每个动作加的高亮延迟。
    actionTimeout: 20_000,
    trace: 'off',
    // 录音（片段 4）要真麦克风数据：Playwright 的假设备 + 自动授权
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        // 无头浏览器默认拦自动播放；演示里 <audio> 要在点击后立刻出声
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },

  projects: [
    {
      name: 'demo',
      // 复用完整版 Chromium（channel: 'chromium'）：本机缺
      // chromium_headless_shell-1248，默认 launch 会找不到可执行文件。
      // 与 e2e 的 mobile 项目保持同一套绕法。
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        // 必须写在 devices 展开之后：Desktop Chrome 自带 1280×720 的 viewport，
        // 与录制的 size 对不上时，画面会被缩放并在底部留一条灰边
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        // 只要 hasTouch，不要 isMobile：isMobile 会让 Chromium 启用移动模拟，
        // 视觉视口被缩到约 57%，screencast 按 390×844 录出来右侧就是一条黑边
        // （实测：isMobile 时 window.innerWidth 还会退回 980 默认布局宽度）。
        // 触摸事件（复习页的按住录音）hasTouch 就够，本项目也没有
        // matchMedia('(pointer: coarse)') 分支。
        hasTouch: true,
      },
    },
  ],

  /**
   * 自己起一套服务，跑在独立端口 + 独立库文件上（见 scripts/constants.ts）。
   * 刻意不复用已在跑的 dev：那套连的是主库 data/app.db，而录制会反复
   * 替换题库、重置进度。库文件的建表与账号创建由服务启动时自动完成。
   *
   * ⚠️ Playwright 起 webServer 的 cwd 是本配置文件所在目录（demo/），
   * 所以先 cd .. 回仓库根 —— server/index.js、DB_PATH、web/dist 都相对根解析。
   *
   * 前置条件：web/dist 已构建（globalSetup 会检查，缺了会带着安装命令报错）。
   */
  webServer: {
    command:
      `cd .. && rm -f ${DEMO_DB_PATH} ${DEMO_DB_PATH}-journal ${DEMO_DB_PATH}-wal ${DEMO_DB_PATH}-shm && ` +
      `APP_ACCOUNT=${DEMO_ACCOUNT} APP_PASSWORD=${DEMO_PASSWORD} SESSION_SECRET=demo-recording-secret ` +
      `DB_PATH=${DEMO_DB_PATH} PORT=${PORT} node server/index.js`,
    url: BASE_URL,
    // 必须 false：若为 true 会复用上一次遗留的服务，而它的库里已经有数据，
    // 「首页显示已背 18/60」这类断言就会莫名其妙失败（e2e 踩过）
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
  },
})
