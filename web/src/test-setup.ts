import '@testing-library/jest-dom/vitest'

// jsdom 没有实现 createObjectURL，而录音回放要靠它把 Blob 变成可播放的 URL。
// 补一个最小实现，否则「回放条」在组件测试里根本渲染不出来。
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock-url'
  URL.revokeObjectURL = () => undefined
}

// jsdom 也没实现音频的 play/pause，调用时会往控制台吐 "Not implemented"，
// 既吵又是个不稳定源。补一套最小实现（含 paused 状态），回放相关的断言才稳定。
const mediaState = new WeakMap<HTMLMediaElement, { paused: boolean }>()

Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
  configurable: true,
  get(this: HTMLMediaElement) {
    return mediaState.get(this)?.paused ?? true
  },
})

HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
  mediaState.set(this, { paused: false })
  this.dispatchEvent(new Event('play'))
  return Promise.resolve()
}

HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) {
  mediaState.set(this, { paused: true })
  this.dispatchEvent(new Event('pause'))
}
