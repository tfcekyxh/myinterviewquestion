// AI 总结每题的回答重点。
// 走 OpenAI 兼容协议（默认智谱 GLM-4.7-Flash，免费档），零原生依赖，只用一个 fetch。
// 免费档硬性规定「同一时刻只有 1 个在途请求」，所以所有调用必须串行化排队。
const BASE_URL = process.env.LLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'
const MODEL = process.env.LLM_MODEL || 'glm-4.7-flash'
const API_KEY = process.env.LLM_API_KEY || ''
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 30000
// 免费档偶发 429（1302 账户频率限制 / 1305 模型过载）/ 5xx / 超时，自动重试几次再放弃。
// 鉴权/参数错误（4xx）不重试，直接抛给路由转错误。
// 退避用 2.5s 起跳：智谱免费档是「按分钟」的频率限制，太短的退避（1s）熬不过限流窗口。
const MAX_ATTEMPTS = Number(process.env.LLM_MAX_ATTEMPTS) || 3
const BACKOFF_MS = Number(process.env.LLM_BACKOFF_MS) || 2500

/** 服务端是否配了 AI 密钥。没配时前端优雅降级，不挡背诵。 */
export function isLlmConfigured(): boolean {
  return Boolean(API_KEY)
}

/**
 * 把模型输出解析成要点数组：每行一条，去掉前缀符号（· - * •）和编号（1. 2、3)）。
 * 纯函数，便于单测，也保证不同模型的输出格式都能收敛成统一结构。
 */
export function parsePoints(text: string): string[] {
  if (!text) return []
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[\s]*([\-\*\u00b7\u2022\u30fb•]|\d+[.、)）])\s*/, ''))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
}

const SYSTEM_PROMPT = `你是面试备考助手。用户会给你一道面试题和参考答案。请提炼回答这道题时【必须覆盖的关键得分点】。要求：
1) 只列要点，不要复述题目，不要写解释性长句；
2) 每条一行，用「· 」开头；
3) 控制在 3–6 条；
4) 用简体中文。`

// 单并发锁：免费档只允许 1 个在途请求，必须排队，否则会 429 / 失败。
let lock: Promise<void> = Promise.resolve()
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = lock.then(task, task)
  // 不管成功失败都把锁往下传，别让一次报错把整条链卡死
  lock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * 调用大模型，返回要点字符串数组。
 * @throws 未配置密钥抛 'AI_NOT_CONFIGURED'；网络/模型异常抛普通 Error（由路由转 502）。
 */
export async function summarizeKeyPoints(question: string, answer: string): Promise<string[]> {
  if (!API_KEY) throw new Error('AI_NOT_CONFIGURED')
  return serialize(async () => {
    let lastErr: Error = new Error('LLM 调用失败')
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // 第二次起退避，错开限流高峰
      if (attempt > 0) await new Promise((r) => setTimeout(r, BACKOFF_MS * attempt))
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      let nonRetryable = false
      try {
        const res = await fetch(`${BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_KEY}`,
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: MODEL,
            temperature: 0.3,
            max_tokens: 1024,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: `题目：\n${question}\n\n参考答案：\n${answer}` },
            ],
          }),
        })
        if (res.ok) {
          // undici 的 res.json() 是 Promise<unknown>，显式收敛成我们要的形状
          const json = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>
          }
          const content = json.choices?.[0]?.message?.content ?? ''
          const points = parsePoints(content)
          if (points.length === 0) throw new Error('LLM 返回为空')
          return points
        }
        const body = await res.text().catch(() => '')
        // 鉴权/参数错误不重试
        if (res.status === 400 || res.status === 401 || res.status === 403) {
          nonRetryable = true
        }
        lastErr = new Error(`LLM ${res.status}: ${body.slice(0, 200)}`)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') lastErr = new Error('LLM 请求超时')
        else if (nonRetryable) throw err
        else lastErr = err instanceof Error ? err : new Error(String(err))
      } finally {
        clearTimeout(timer)
      }
      // 4xx 鉴权/参数错误已 throw，走到这里说明是 429/5xx/超时/网络，进入下一轮重试
    }
    throw lastErr
  })
}
