/**
 * 题库 PDF 解析 —— 纯函数模块（不依赖 DOM / pdfjs，可单测、可在 Node 里直接跑）。
 *
 * 排版特征（来自 pdf/Java 热门面试题 200 道速记通关版 面试刷题 mianshiyacom.pdf 实测）：
 *   - 130 页、3106 个文本行，无页眉页脚
 *   - 正文行字号 ≈ 8.25；题干行字号 ≈ 9.65（约为正文的 1.17 倍）；封面标题 16.5
 *   - 题干行恰好 200 行，与「200 道」吻合，且互不重复
 *   - 答案会跨页，所以不能按页切题；只能按「字号台阶」切
 *
 * 因此切题的核心信号是**字号**，不是编号、也不是空行。
 */

/** 从 pdfjs 的 getTextContent() 映射出来的最小文本项 */
export interface RawItem {
  page: number
  str: string
  /** 字号近似值：优先取 pdfjs 的 height，否则由 transform 推导 */
  size: number
  x: number
  y: number
  width: number
}

/** 由若干 RawItem 合并出的一行 */
export interface TextLine {
  page: number
  text: string
  /** 按字符数加权的平均字号 */
  size: number
  left: number
  right: number
}

export interface Question {
  /** 从 1 开始的题号，顺序严格保留 PDF 原序 */
  seq: number
  question: string
  answer: string
}

export interface ParseOptions {
  /** 同一行的 y 坐标容差（PDF 单位），默认 1.5 */
  yTolerance?: number
  /** 题干字号 / 正文字号 的下界，默认 1.08 */
  titleRatioMin?: number
  /** 题干字号 / 正文字号 的上界，用于排除封面大标题，默认 1.6 */
  titleRatioMax?: number
}

export interface ParseResult {
  questions: Question[]
  stats: {
    pages: number
    lines: number
    /** 判定为题干的行数 */
    titleLines: number
    /** 首个题干之前被丢弃的行数（封面 / 广告） */
    skippedPreamble: number
    bodySize: number
  }
  warnings: string[]
}

const DEFAULTS: Required<ParseOptions> = {
  yTolerance: 1.5,
  titleRatioMin: 1.08,
  titleRatioMax: 1.6,
}

/**
 * 该 PDF 内嵌的是子集化字体，ToUnicode 映射有误：一批常用汉字被映射到了
 * 「CJK 部首补充区 U+2E80–U+2EFF」和「康熙部首区 U+2F00–U+2FDF」。
 * 实测：全文 5.18% 的字符受影响（如 ⽤→用、⼀→一、⾯→面）。
 * 这些码位在手机上未必有字形，且无法被搜索，必须还原成正字。
 *
 * 康熙部首区有标准的 NFKC 兼容映射，直接归一化即可；
 * 「C-simplified」那批（见长风门页骨马车贝飞鱼鬼角）Unicode 没有给兼容映射，只能查表。
 */
const RADICAL_FIX: Record<string, string> = {
  '⻅': '见', '⻓': '长', '⻛': '风', '⻔': '门', '⻚': '页', '⻣': '骨', '⻢': '马',
  '⻬': '齐', '⻋': '车', '⻉': '贝', '⻜': '飞', '⻥': '鱼', '⻤': '鬼', '⻆': '角',
}

/** 把部首区字符还原成对应的汉字正字；其余字符原样返回 */
export function normalizeRadicals(text: string): string {
  return text.replace(/[\u2E80-\u2FDF]/g, (ch) => {
    const fixed = RADICAL_FIX[ch]
    if (fixed) return fixed
    const n = ch.normalize('NFKC')
    return n !== ch ? n : ch
  })
}

/** 列表项开头：1）/ 1. / 1、/ • / - 等 */
const LIST_MARKER = /^\s*(\d{1,3}\s*[）.、.．]|[•·▪‣◦]\s|[-*—]\s)/

/** 行尾标点/符号：出现这些说明这一行是段落结尾或代码行结尾，而不是被排版截断的软换行 */
const LINE_END = /[。！？…；：!?;{}]$/

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[i]
}

/**
 * 把 pdfjs 的散碎文本项按「页 + y 坐标」聚成行。
 * 注意：该 PDF 是逐字形绘制的，同一行内各字形的 y 有微小抖动，必须给容差。
 */
export function buildLines(items: RawItem[], options: ParseOptions = {}): TextLine[] {
  const { yTolerance } = { ...DEFAULTS, ...options }
  const byPage = new Map<number, RawItem[]>()
  for (const it of items) {
    if (!it.str) continue
    let arr = byPage.get(it.page)
    if (!arr) byPage.set(it.page, (arr = []))
    arr.push(it)
  }

  // 该 PDF 是逐字形绘制的：行要边扫边攒，整行收齐后才能生成 TextLine
  const lines: TextLine[] = []
  for (const [page, arr] of byPage) {
    arr.sort((a, b) => b.y - a.y || a.x - b.x)
    let cur: RawItem[] | null = null
    let curY = 0
    const flush = () => {
      if (cur && cur.length) lines.push(makeLine(page, cur))
    }
    for (const it of arr) {
      if (cur && Math.abs(it.y - curY) <= yTolerance) {
        cur.push(it)
      } else {
        flush()
        cur = [it]
        curY = it.y
      }
    }
    flush()
  }
  lines.sort((a, b) => a.page - b.page)
  return lines.filter((l) => l.text.trim().length > 0)
}

function makeLine(page: number, items: RawItem[]): TextLine {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  let weight = 0
  let sum = 0
  for (const it of sorted) {
    sum += it.size * it.str.length
    weight += it.str.length
  }
  return {
    page,
    text: normalizeRadicals(sorted.map((i) => i.str).join('')),
    size: weight ? sum / weight : 0,
    left: Math.min(...sorted.map((i) => i.x)),
    right: Math.max(...sorted.map((i) => i.x + i.width)),
  }
}

/**
 * 正文主流字号：取「字符数最多的字号桶」（众数），不是平均值。
 * 平均值会被题干行和封面大标题拉偏 —— 题目少的时候偏差足以让题干判定直接失效，
 * 而正文永远占绝大多数行，取众数才稳。
 */
export function detectBodySize(lines: TextLine[]): number {
  const buckets = new Map<number, number>()
  for (const l of lines) {
    const n = l.text.trim().length
    if (!n) continue
    const k = Math.round(l.size * 4) / 4 // 0.25 一档
    buckets.set(k, (buckets.get(k) ?? 0) + n)
  }
  let best = 0
  let bestN = -1
  for (const [k, n] of buckets) {
    if (n > bestN) {
      bestN = n
      best = k
    }
  }
  return best
}

/** 是否是题干行 */
export function isTitleLine(line: TextLine, bodySize: number, options: ParseOptions = {}): boolean {
  const { titleRatioMin, titleRatioMax } = { ...DEFAULTS, ...options }
  const ratio = line.size / bodySize
  return ratio >= titleRatioMin && ratio <= titleRatioMax
}

/** 合并答案行：还原被排版截断的软换行，保留真正的段落边界 */
function joinAnswer(lines: TextLine[], colRight: number): string {
  const out: string[] = []
  let buf = ''

  const flush = () => {
    const t = buf.trim()
    if (t) out.push(t)
    buf = ''
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const text = line.text.replace(/[ \t]+$/, '')
    if (i === 0) {
      buf = text
      continue
    }
    const prev = lines[i - 1]
    const prevEnd = prev.text.trimEnd()

    const hard =
      LIST_MARKER.test(text) || // 新的列表项
      LINE_END.test(prevEnd) || // 上一行已收句 / 是代码行结尾
      prev.right < colRight * 0.55 // 上一行明显没排满（小标题或段落尾）

    if (hard) {
      flush()
      buf = text
    } else {
      buf += glue(prevEnd, text) + text
    }
  }
  flush()
  return out.join('\n')
}

/** 拼接被软换行拆开的两行时，是否需要补一个空格 */
function glue(prevEnd: string, next: string): string {
  const a = prevEnd.slice(-1)
  const b = next.slice(0, 1)
  if (!a || !b) return ''
  // 拉丁单词被拆成两半时不能插空格
  if (/[A-Za-z0-9)\]}]/.test(a) && /[A-Za-z0-9]/.test(b)) return ''
  // 上一行以半角字符收尾（MySQL / VARCHAR(255) / user_id），下一行接中文或符号时补空格
  if (/[A-Za-z0-9)\]}]/.test(a)) {
    // 但下一行以小写字母开头，多半是同一个拉丁单词被拆成两半，不能插空格
    return /[a-z]/.test(b) ? '' : ' '
  }
  return ''
}

/**
 * 切题主入口。
 * 规则：字号高于正文一档的行 = 题干；题干之后到下一个题干之前的所有行 = 该题答案。
 */
export function parseQuestions(lines: TextLine[], options: ParseOptions = {}): ParseResult {
  const opts = { ...DEFAULTS, ...options }
  const warnings: string[] = []
  if (lines.length === 0) {
    return {
      questions: [],
      stats: { pages: 0, lines: 0, titleLines: 0, skippedPreamble: 0, bodySize: 0 },
      warnings: ['PDF 没有抽到任何文本，可能是扫描件（无文本层），需要 OCR'],
    }
  }

  const bodySize = detectBodySize(lines)
  const pages = Math.max(...lines.map((l) => l.page))

  const titleIdx: number[] = []
  for (let i = 0; i < lines.length; i++) {
    if (isTitleLine(lines[i], bodySize, opts)) titleIdx.push(i)
  }

  if (titleIdx.length === 0) {
    return {
      questions: [],
      stats: { pages, lines: lines.length, titleLines: 0, skippedPreamble: lines.length, bodySize },
      warnings: [`没找到题干行（正文基准字号 ${bodySize.toFixed(2)}），切题规则可能不适用`],
    }
  }

  const colRight = percentile(lines.map((l) => l.right).sort((a, b) => a - b), 0.95)

  // 题干可能折行：先把「连续相邻的题干行」归并成一个题干块
  // （真实 PDF 里 200 道题的题干都只有一行，这里是为长题干兜底）
  const blocks: Array<{ titleStart: number; bodyStart: number; end: number }> = []
  for (let k = 0; k < titleIdx.length; k++) {
    let last = k
    while (last + 1 < titleIdx.length && titleIdx[last + 1] === titleIdx[last] + 1) last++
    blocks.push({
      titleStart: titleIdx[k],
      bodyStart: titleIdx[last] + 1,
      end: last + 1 < titleIdx.length ? titleIdx[last + 1] : lines.length,
    })
    k = last
  }

  const questions: Question[] = []
  for (const b of blocks) {
    const question = lines
      .slice(b.titleStart, b.bodyStart)
      .map((l) => l.text.trim())
      .join('')
      .trim()
    const answer = joinAnswer(lines.slice(b.bodyStart, b.end), colRight)

    if (!question) {
      warnings.push(`第 ${questions.length + 1} 题题干为空，已跳过`)
      continue
    }
    if (!answer) warnings.push(`第 ${questions.length + 1} 题「${question.slice(0, 20)}…」没有抽到答案`)
    if (question.length > 120) warnings.push(`第 ${questions.length + 1} 题题干异常长（${question.length} 字），疑似误判`)

    questions.push({ seq: questions.length + 1, question, answer })
  }

  return {
    questions,
    stats: { pages, lines: lines.length, titleLines: titleIdx.length, skippedPreamble: titleIdx[0], bodySize },
    warnings,
  }
}

/** 一步到位：从 pdfjs 文本项直接得到题目 */
export function parseItems(items: RawItem[], options: ParseOptions = {}): ParseResult {
  return parseQuestions(buildLines(items, options), options)
}
