// 与后端通信的唯一入口。
// 全部走 same-origin 相对路径：Express 同时托管页面和 /api，不存在跨域。
export interface SessionUser {
  userId: number
  account: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new ApiError(data?.error ?? `请求失败（${res.status}）`, res.status)
  }
  return data as T
}

/** 当前登录状态；未登录返回 null */
export async function fetchMe(): Promise<SessionUser | null> {
  try {
    return await request<SessionUser>('/api/me')
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  }
}

export async function login(account: string, password: string): Promise<SessionUser> {
  return request<SessionUser>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ account, password }),
  })
}

export async function logout(): Promise<void> {
  await request<{ ok: true }>('/api/logout', { method: 'POST' })
}
