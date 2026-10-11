import { defineConfig, devices } from '@playwright/test'

const PORT = 3100
const BASE = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // 所有 spec 共用同一个服务与 data/test.db，而 Playwright 按文件路径排序执行。
  // 唯一依赖「全新数据库」的用例放在 00-empty.spec.ts 里。
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    // 本机缺 chromium_headless_shell（install 时 ffmpeg 下载失败导致后续组件没装上），
    // 用完整 Chromium 绕开
    channel: 'chromium',
    permissions: ['microphone'],
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [
    {
      name: 'mobile',
      use: {
        // 必须写在 ...devices 之前：devices['iPhone 13'] 默认会把浏览器切成 WebKit
        browserName: 'chromium',
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    // 每次跑 e2e 都用一份全新的 test.db，绝不碰 data/app.db
    command: `rm -f data/test.db && NODE_ENV=test PORT=${PORT} node server/index.js`,
    url: BASE, // 探测根路径，404 也算未就绪
    // 必须 false：若为 true 会复用上一次遗留的服务，而它的 test.db 里已经有数据，
    // 「未导入时首页是空状态」这类用例就会莫名其妙失败（踩过）
    reuseExistingServer: false,
    stdout: 'pipe',
  },
})
