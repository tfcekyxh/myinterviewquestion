import { describe, expect, it } from 'vitest'
import { normalizeRadicals, parseItems, type RawItem } from './parse'

const TITLE = 9.65 // 题干字号（真实 PDF 实测值）
const BODY = 8.25 // 正文字号

/** 构造一行文本项：逐字形绘制，x 递增 */
function line(page: number, y: number, text: string, size: number, x0 = 56, charW = 8): RawItem[] {
  return Array.from(text, (str, i) => ({ page, str, size, x: x0 + i * charW, y, width: charW }))
}

/** 一道标准题：题干 1 行 + 答案 3 行（保持与真实 PDF 相近的正文占比，基准字号才准） */
function block(page: number, yTop: number, question: string, answerLines: string[]): RawItem[] {
  const items = line(page, yTop, question, TITLE)
  answerLines.forEach((t, i) => items.push(...line(page, yTop - (i + 1) * 10, t, BODY)))
  return items
}

describe('parseItems', () => {
  it('正常两题：按字号台阶切开，题干与答案一一对应', () => {
    const r = parseItems([
      ...block(1, 100, '第一题是什么？', ['第一题答案第一段。', '第一题答案第二段。', '第一题答案第三段。']),
      ...block(1, 60, '第二题是什么？', ['第二题答案第一段。', '第二题答案第二段。', '第二题答案第三段。']),
    ])
    expect(r.questions).toHaveLength(2)
    expect(r.stats.titleLines).toBe(2)
    expect(r.questions[0].question).toBe('第一题是什么？')
    expect(r.questions[0].answer).toBe('第一题答案第一段。\n第一题答案第二段。\n第一题答案第三段。')
    expect(r.questions[1].question).toBe('第二题是什么？')
  })

  it('跨页题：答案跨页不会被切断，也不会串行到下一题', () => {
    const r = parseItems([
      ...line(1, 100, '跨页题是什么？', TITLE),
      ...line(1, 90, '答案开头写在第一页，', BODY),
      ...line(1, 80, '中间这一行也在第一页。', BODY),
      ...line(2, 100, '答案尾巴落在第二页。', BODY),
      ...line(2, 90, '下一题是什么？', TITLE),
      ...line(2, 80, '下一题的答案。', BODY),
      ...line(2, 70, '下一题答案补充。', BODY),
      ...line(2, 60, '下一题答案收尾。', BODY),
    ])
    expect(r.stats.pages).toBe(2)
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].answer).toContain('答案开头写在第一页，')
    expect(r.questions[0].answer).toContain('答案尾巴落在第二页。')
    expect(r.questions[0].answer).not.toContain('下一题')
    expect(r.questions[1].question).toBe('下一题是什么？')
  })

  it('编号异常：答案里的 1）/ 2）不会被误判成新题', () => {
    const r = parseItems([
      ...line(1, 100, '带编号的题？', TITLE),
      ...line(1, 90, '1）第一条要点说明。', BODY),
      ...line(1, 80, '2）第二条要点说明。', BODY),
      ...line(1, 70, '3）第三条要点说明。', BODY),
      ...line(1, 60, '没有编号的题？', TITLE),
      ...line(1, 50, '它的答案。', BODY),
      ...line(1, 40, '它的答案补充。', BODY),
      ...line(1, 30, '它的答案收尾。', BODY),
    ])
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].answer.split('\n')).toEqual([
      '1）第一条要点说明。',
      '2）第二条要点说明。',
      '3）第三条要点说明。',
    ])
  })

  it('答案内的软换行被合并，真正的段落边界保留', () => {
    const r = parseItems([
      ...line(1, 100, '换行题？', TITLE),
      // 排满且不以句末标点收尾 → 软换行，应与下一行合并
      ...line(1, 90, '这是一段被排版截断的话没有结束', BODY, 56, 15),
      ...line(1, 80, '接着上一句说完。', BODY, 56, 15),
      // 以句号收尾 → 段落结束，应换行
      ...line(1, 70, '这是新的一段已经结束。', BODY, 56, 15),
      ...line(1, 60, '另一题？', TITLE),
      ...line(1, 50, '它的答案。', BODY),
      ...line(1, 40, '它的答案补充。', BODY),
      ...line(1, 30, '它的答案收尾。', BODY),
    ])
    expect(r.questions[0].answer).toBe('这是一段被排版截断的话没有结束接着上一句说完。\n这是新的一段已经结束。')
  })

  it('半角收尾的行与中文之间会补空格，不会粘成 MySQL的', () => {
    const r = parseItems([
      ...line(1, 100, '半角题？', TITLE),
      ...line(1, 90, '这里提到了 MySQL', BODY, 56, 15),
      ...line(1, 80, '的默认引擎是 InnoDB。', BODY, 56, 15),
      ...line(1, 70, '另一题？', TITLE),
      ...line(1, 60, '它的答案。', BODY),
      ...line(1, 50, '它的答案补充。', BODY),
      ...line(1, 40, '它的答案收尾。', BODY),
    ])
    expect(r.questions[0].answer).toContain('MySQL 的默认引擎')
  })

  it('题干折行：相邻的两行题干合并成一道题', () => {
    const r = parseItems([
      ...line(1, 100, '这一题的题干特别长以至于排到了', TITLE),
      ...line(1, 90, '第二行才结束，怎么办？', TITLE),
      ...line(1, 80, '答案第一行，说点什么内容。', BODY),
      ...line(1, 70, '答案第二行，继续说点内容。', BODY),
      ...line(1, 60, '答案第三行，最后说点内容。', BODY),
    ])
    expect(r.questions).toHaveLength(1)
    expect(r.questions[0].question).toBe('这一题的题干特别长以至于排到了第二行才结束，怎么办？')
  })

  it('封面大标题不会被当成题干', () => {
    const r = parseItems([
      ...line(1, 120, 'Java 热门面试题 200 道', 16.5),
      ...line(1, 110, '本资源来自面试鸭：https://x.com', 8.5),
      ...line(1, 100, '推荐更多免费学编程资源：', 8.5),
      ...block(1, 90, '真正第一题？', ['答案第一行。', '答案第二行。', '答案第三行。']),
      ...block(1, 50, '第二题？', ['答案第一行。', '答案第二行。', '答案第三行。']),
    ])
    expect(r.questions).toHaveLength(2)
    expect(r.questions[0].question).toBe('真正第一题？')
    expect(r.stats.skippedPreamble).toBeGreaterThan(0)
  })

  it('无文本层（扫描件）时给出明确告警，而不是静默返回空', () => {
    const r = parseItems([])
    expect(r.questions).toEqual([])
    expect(r.warnings.join()).toContain('OCR')
  })

  it('题干顺序保留 PDF 原序', () => {
    const r = parseItems([
      ...block(1, 100, 'A 题？', ['答案。', '答案补充。', '答案收尾。']),
      ...block(1, 60, 'B 题？', ['答案。', '答案补充。', '答案收尾。']),
      ...block(1, 20, 'C 题？', ['答案。', '答案补充。', '答案收尾。']),
    ])
    expect(r.questions.map((q) => q.question)).toEqual(['A 题？', 'B 题？', 'C 题？'])
    expect(r.questions.map((q) => q.seq)).toEqual([1, 2, 3])
  })
})

describe('normalizeRadicals', () => {
  it('还原康熙部首区（NFKC 有映射的那批）', () => {
    expect(normalizeRadicals('⽤⼀⽐⾏⾼⾯')).toBe('用一比行高面')
  })

  it('还原 CJK 部首补充区（Unicode 没有兼容映射的那批）', () => {
    expect(normalizeRadicals('⻅⻓⻔⻚⻢⻋')).toBe('见长门页马车')
  })

  it('不影响正常汉字、全角标点与半角字符', () => {
    expect(normalizeRadicals('HashMap（JDK 1.8）的负载因子是 0.75。')).toBe('HashMap（JDK 1.8）的负载因子是 0.75。')
  })

  it('解析时自动生效：题干与答案里的部首字符都被还原', () => {
    const r = parseItems([
      ...block(1, 100, '项⽬⾥⽤什么？', ['答案第⼀⾏。', '答案第⼆⾏。', '答案第三⾏。']),
      ...block(1, 60, '第⼆题？', ['答案第⼀⾏。', '答案第⼆⾏。', '答案第三⾏。']),
    ])
    expect(r.questions[0].question).toBe('项目里用什么？')
    expect(r.questions[0].answer).toContain('答案第一行。')
  })
})
