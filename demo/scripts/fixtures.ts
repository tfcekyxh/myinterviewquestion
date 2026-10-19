import { test as base, expect } from '@playwright/test'
import { stopClip } from './demo-utils'

/**
 * 演示录制专用的 test。
 *
 * 只加一层保险：用例中途失败时也把正在录的视频停掉落盘。
 * 视频本身是各条 spec 用 startClip 显式开关的（见 demo-utils），
 * 不走配置里的 use.video —— 那样会把准备步骤与开场白屏一起录进去，
 * 而且它给每个动作加的展示高亮会引入明显延迟。
 */
export const test = base.extend<{ clipRecorder: void }>({
  clipRecorder: [
    async ({ page }, use) => {
      await use()
      await stopClip(page)
    },
    { auto: true },
  ],
})

export { expect }
