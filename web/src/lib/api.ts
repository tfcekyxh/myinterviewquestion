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

export interface Question {
  seq: number
  question: string
  answer: string
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
