/**
 * 答案批量导入 / 导出。
 *
 * 扫描版行测试卷常常没有答案页，用户需要按答案表一次性录入几十上百题。
 * 这里支持常见写法：`1A 2B`、`1.A 2.B`、`1、A`、`1A2B3C`、每行一题，
 * 以及不带编号的连续字母串 `ABCD`（按题序 1/2/3/4）。
 *
 * 匹配优先用「原文题号」，因为文档按部分重置题号时数组下标并不可靠；
 * 用户也可显式切换到「列表序号」匹配（导出文本默认带原文题号）。
 */

/** 一条编号答案，如 { no: 12, answer: 'AB' } */
export interface AnswerPair {
  no: number
  answer: string
}

export interface ParsedAnswers {
  pairs: AnswerPair[]
  /** 无法识别的行，原样回显供用户修正 */
  invalid: string[]
}

const NUMBERED_RE = /(\d{1,3})\s*[.．、:：)）\-—]?\s*([A-Da-d]{1,4})(?![A-Za-z])/g
const NUMBERED_LINE_RE = /^\s*\d{1,3}\s*[.．、:：)）\-—]?\s*[A-Da-d]{1,4}(?![A-Za-z])/
const LETTERS_ONLY_RE = /^[A-Da-d\s,，、.．\n]+$/

/** 解析用户粘贴的答案文本，不依赖任何题目数据 */
export function parseAnswerText(input: string): ParsedAnswers {
  const text = String(input ?? '')
    .replace(/```[a-z]*\s*/gi, '')
    .replace(/答案\s*[：:]/g, ' ')
    .trim()
  if (!text) return { pairs: [], invalid: [] }

  const pairs: AnswerPair[] = []
  let match: RegExpExecArray | null
  NUMBERED_RE.lastIndex = 0
  while ((match = NUMBERED_RE.exec(text))) {
    const no = Number(match[1])
    if (no >= 1 && no <= 999) pairs.push({ no, answer: match[2].toUpperCase() })
  }
  // 保留重复题号：行测套卷各部分题号会从 1 重新起算（1A 2B 1C 2D）。
  // 「重复题号取最后一次」只在匹配阶段、且目标题号唯一时才成立，见 applyAnswerImport。
  if (pairs.length) return { pairs, invalid: [] }

  // 纯字母串：按顺序题号 1..N
  if (LETTERS_ONLY_RE.test(text)) {
    const letters = text.match(/[A-Da-d]/g) ?? []
    return {
      pairs: letters.map((letter, index) => ({ no: index + 1, answer: letter.toUpperCase() })),
      invalid: [],
    }
  }

  const invalid = text.split('\n').map((line) => line.trim()).filter((line) => line && !NUMBERED_LINE_RE.test(line))
  return { pairs: [], invalid }
}

/** 参与批量导入的最小题目形状 */
export interface AnswerTarget {
  id: string
  no?: number
  title: string
  answer: string
}

export interface AnswerMatch {
  id: string
  no: number
  answer: string
  /** 输入中的题号（可能与列表序号不同） */
  sourceNo: number
  titlePreview: string
}

export interface AnswerApplyResult {
  /** id → 新答案，直接交给上层写库 */
  answers: Record<string, string>
  matched: AnswerMatch[]
  unmatched: AnswerPair[]
  invalid: string[]
  by: 'no' | 'index'
}

/** 按题号或列表序号把答案对齐到题目，返回可预览的匹配结果 */
export function applyAnswerImport(
  targets: AnswerTarget[],
  text: string,
  by: 'no' | 'index' = 'no',
): AnswerApplyResult {
  const parsed = parseAnswerText(text)
  const answers: Record<string, string> = {}
  const matched: AnswerMatch[] = []
  const unmatched: AnswerPair[] = []
  const used = new Set<string>()

  // 行测套卷题号按部分重置（第一部分 1..20、第二部分又是 1..15），
  // 同题号必须保留所有题槽，按答案表中出现的先后顺序依次分配。
  const noGroups = new Map<number, AnswerTarget[]>()
  const byIndex = new Map<number, AnswerTarget>()
  targets.forEach((target, index) => {
    byIndex.set(index + 1, target)
    if (typeof target.no === 'number' && target.no > 0) {
      noGroups.set(target.no, [...(noGroups.get(target.no) ?? []), target])
    }
  })
  const noCursor = new Map<number, number>()

  parsed.pairs.forEach((pair) => {
    let target: AnswerTarget | undefined
    /** 目标题号唯一时，重复出现的同号答案取最后一次（用户末尾修正） */
    let allowOverride = false
    if (by === 'no') {
      const group = noGroups.get(pair.no)
      if (group && group.length > 1) {
        // 题号按部分重置：同号对应多道题，按出现顺序依次分配
        const cursor = noCursor.get(pair.no) ?? 0
        target = group[cursor]
        if (target) noCursor.set(pair.no, cursor + 1)
      } else if (group?.length === 1) {
        target = group[0]
        allowOverride = true
      } else {
        // 目标里没有该题号，回退到列表序号
        target = byIndex.get(pair.no)
        allowOverride = true
      }
    } else {
      target = byIndex.get(pair.no)
      allowOverride = true
    }
    if (!target) { unmatched.push(pair); return }
    const alreadyMatched = used.has(target.id)
    if (alreadyMatched && !allowOverride) { unmatched.push(pair); return }
    used.add(target.id)
    answers[target.id] = pair.answer
    const chosen = target
    const match: AnswerMatch = {
      id: chosen.id,
      no: chosen.no ?? (targets.findIndex((item) => item.id === chosen.id) + 1),
      answer: pair.answer,
      sourceNo: pair.no,
      titlePreview: String(chosen.title ?? '').replace(/\s+/g, ' ').slice(0, 28),
    }
    // 覆盖时替换已有预览行，避免同一题在匹配列表里出现两次
    if (alreadyMatched) {
      const index = matched.findIndex((item) => item.id === chosen.id)
      if (index >= 0) matched[index] = match
      else matched.push(match)
    } else {
      matched.push(match)
    }
  })

  return { answers, matched, unmatched, invalid: parsed.invalid, by }
}

/** 导出当前答案表：优先原文题号，缺失时用列表序号 */
export function exportAnswerText(questions: Array<{ no?: number; answer?: string }>): string {
  return questions
    .map((question, index) => ({
      no: question.no ?? index + 1,
      answer: String(question.answer ?? '').trim().toUpperCase().replace(/[^A-D]/g, ''),
    }))
    .filter((item) => item.answer)
    .map((item) => `${item.no}${item.answer}`)
    .join(' ')
}
