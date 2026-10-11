import { defineConfig, devices } from '@playwright/test'

const PORT = 3100
const BASE = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: './e2e',
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
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
  },
})
