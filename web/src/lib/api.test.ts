import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  NET_ERROR_MESSAGE,
  fetchBank,
  fetchMe,
  login,
  setUnauthorizedHandler,
} from './api'

/**
 * P5 的重点全在这里：**失败必须给得出人能看懂的话**。
 * 之前 fetch 一 reject 就抛英文 TypeError，页面直接把它当文案显示出来；
 * 后端 502 回一页 HTML 时 JSON.parse 也会炸。两条都必须兜住。
 */
describe('api 的失败兜底', () => {
  beforeEach(() => {
    setUnauthorizedHandler(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setUnauthorizedHandler(null)
  })

  it('请求发不出去（断网）时抛中文提示，而不是英文 TypeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    await expect(fetchBank()).rejects.toThrow(NET_ERROR_MESSAGE)
  })

  it('网关回一页 HTML（非 JSON）时不会炸成 JSON 解析错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    )

    await expect(fetchBank()).rejects.toThrow('服务器出错了，稍后再试')
  })

  it('后端回了 error 字段就用后端的文案（比如「账号或密码不正确」）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: '账号或密码不正确' }), { status: 400 }),
      ),
    )

    await expect(login('a', 'b')).rejects.toThrow('账号或密码不正确')
  })

  it('其他接口撞到 401 会通知登录态失效', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '未登录' }), { status: 401 })),
    )

    await expect(fetchBank()).rejects.toBeInstanceOf(ApiError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('密码错（/api/login 的 401）不能把用户当成掉线踢出去', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: '账号或密码不正确' }), { status: 401 }),
      ),
    )

    await expect(login('a', 'b')).rejects.toThrow('账号或密码不正确')
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  it('未登录探活（/api/me 的 401）返回 null，也不触发掉线', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '未登录' }), { status: 401 })),
    )

    await expect(fetchMe()).resolves.toBeNull()
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
