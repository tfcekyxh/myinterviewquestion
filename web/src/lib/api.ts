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

/**
 * 网络层失败的统一文案。
 * fetch 只在「请求根本没发出去」时 reject（断网、DNS 失败、服务挂了），
 * 这时抛的是英文 TypeError，直接显示给用户就是一句看不懂的话 —— 必须换成能看懂的。
 */
export const NET_ERROR_MESSAGE = '连不上服务器，请检查网络后重试'

/** 登录态失效的处理方，由 session 层注册。页面不用各自判断 401 */
let unauthorizedHandler: (() => void) | null = null

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn
}

interface RequestOptions {
  /**
   * 这两个接口的 401 是「正常的业务结果」，不是登录态失效：
   *  - /api/me 未登录返回 null，本来就是用来探活的
   *  - /api/login 密码错也是 401，那是「密码不对」，不该把用户踢回登录页
   * 若不跳过，会触发 handler → 再探活 → 又 401 的死循环。
   */
  skipAuthHook?: boolean
}

async function request<T>(
  path: string,
  init?: RequestInit,
  opts: RequestOptions = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(NET_ERROR_MESSAGE, 0)
  }

  const text = await res.text().catch(() => '')
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      // 反向代理 / 网关挂掉时会回一页 HTML，JSON.parse 会炸成一句看不懂的话
      data = null
    }
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.skipAuthHook) unauthorizedHandler?.()
    const fallback = res.status >= 500 ? '服务器出错了，稍后再试' : `请求失败（${res.status}）`
    throw new ApiError((data as { error?: string } | null)?.error ?? fallback, res.status)
  }
  return data as T
}

/** 当前登录状态；未登录返回 null */
export async function fetchMe(): Promise<SessionUser | null> {
  try {
    return await request<SessionUser>('/api/me', undefined, { skipAuthHook: true })
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null
    throw e
  }
}

export async function login(account: string, password: string): Promise<SessionUser> {
  return request<SessionUser>(
    '/api/login',
    {
      method: 'POST',
      body: JSON.stringify({ account, password }),
    },
    { skipAuthHook: true },
  )
}

export interface Question {
  seq: number
  question: string
  answer: string
}

/** 单题的「回答重点」。source='ai' 为模型生成，'user' 为用户改过/自建。 */
export interface KeyPoints {
  seq: number
  points: string[]
  source: 'ai' | 'user'
  updatedAt: number | null
}

export interface BankInfo {
  total: number
  source: string | null
  importedAt: number | null
}

export interface ParsedQuestion {
  question: string
  answer: string
}

export async function fetchBank(): Promise<BankInfo> {
  return request<BankInfo>('/api/questions')
}

/** 含全部题目（导出 / 背诵用） */
export async function fetchFullBank(): Promise<BankInfo & { questions: Question[] }> {
  return request<BankInfo & { questions: Question[] }>('/api/questions?full=1')
}

export async function saveQuestions(
  source: string,
  questions: ParsedQuestion[],
): Promise<{ ok: true; total: number }> {
  return request<{ ok: true; total: number }>('/api/questions', {
    method: 'POST',
    body: JSON.stringify({ source, questions }),
  })
}

export async function logout(): Promise<void> {
  await request<{ ok: true }>('/api/logout', { method: 'POST' })
}

/**
 * 导出整库文件（SQLite 源文件）。
 * 和「导出题库 JSON」的区别：JSON 只有题目，这个连**背诵进度、复习记录、账号**一起带走。
 * 所以服务端数据真丢了，靠它才复原得回来。
 */
export async function downloadBackup(): Promise<Blob> {
  const res = await fetch('/api/backup', { credentials: 'same-origin' })
  if (!res.ok) throw new ApiError('导出失败，请重试', res.status)
  return res.blob()
}

/** 用整库文件还原。**会覆盖当前所有数据**（题库、进度、复习记录） */
export async function restoreBackup(file: File): Promise<{ ok: true; total: number }> {
  const res = await fetch('/api/backup', {
    method: 'POST',
    credentials: 'same-origin',
    // 整个文件原样送过去，别设 Content-Type: application/json
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  const text = await res.text()
  let data: { ok?: boolean; total?: number; error?: string } = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    /* 网关回 HTML 之类 */
  }
  if (!res.ok) throw new ApiError(data.error ?? '还原失败，数据未被修改', res.status)
  return data as { ok: true; total: number }
}

export type ReciteMode = 'order' | 'random'

/** 「刚背完的一轮」：从这一轮起点背到最后一题为止的那批题 */
export interface ReviewRound {
  seqs: number[]
  count: number
}

/**
 * 背诵进度。顺序与随机各存一个位置 —— 两种模式来回切都不会丢进度。
 * randOrder 是随机模式下的题目序号序列（seq 的排列）。
 * roundStart 是当前这一轮的起点（进入背诵页时写成当时的位置），背完即结算成 lastRound。
 */
export interface ProgressState {
  mode: ReciteMode
  posOrder: number
  posRandom: number
  randOrder: number[]
  roundStart: number | null
  lastRound: ReviewRound | null
  total: number
  updatedAt: number | null
}

export async function fetchProgress(): Promise<ProgressState> {
  return request<ProgressState>('/api/progress')
}

export type ProgressPatch = Partial<
  Pick<ProgressState, 'mode' | 'posOrder' | 'posRandom' | 'randOrder' | 'roundStart'>
>

export async function saveProgress(patch: ProgressPatch): Promise<ProgressState> {
  return request<ProgressState>('/api/progress', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export async function resetProgress(): Promise<void> {
  await request<{ ok: true }>('/api/progress', { method: 'DELETE' })
}

/** 取某题的回答重点。首次访问会在服务端调模型生成并缓存，之后直接读库（可离线）。 */
export async function fetchKeyPoints(seq: number, signal?: AbortSignal): Promise<KeyPoints> {
  return request<KeyPoints>(`/api/keypoints/${seq}`, signal ? { signal } : undefined)
}

/** 保存用户自己改过的重点。 */
export async function saveKeyPoints(seq: number, points: string[]): Promise<KeyPoints> {
  return request<KeyPoints>(`/api/keypoints/${seq}`, {
    method: 'PUT',
    body: JSON.stringify({ points }),
  })
}

/** 强制让 AI 重新生成一遍重点。 */
export async function regenerateKeyPoints(seq: number): Promise<KeyPoints> {
  return request<KeyPoints>(`/api/keypoints/${seq}/regenerate`, { method: 'POST' })
}

/** 记一条复习记录。音频不上云，只记「哪一题、讲了多久、本机录音的键」 */
export async function saveReview(input: {
  seq: number
  durationMs: number
  clipKey?: string | null
}): Promise<void> {
  await request<{ ok: true }>('/api/reviews', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
