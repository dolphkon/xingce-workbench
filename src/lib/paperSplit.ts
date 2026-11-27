/**
 * 规则切题引擎（纯函数模块，可独立回归测试）。
 *
 * 从 OCR/文本层提取的整篇试卷文本中按题号拆成单题块，再做单题结构化。
 * 难点：扫描版试卷片段常从任意题号开始（如 "42." 起手）、题号按部分重置
 * （42 → 2 → 3…）、题号挤在句中（"…127.2020年…128.2020年…"）。
 * 本模块用「候选过滤 + 递增分段 + 重置检测」替代脆弱的全局 LIS 约束。
 */
import type { QuizQuestion } from '../types'
import { sanitizeSharedMaterial } from './examClean'
import { parseQuestionText } from './ocr'
import { refineAtomicQuestion, stripQuestionNumber } from './questionClean'
import { uid } from './utils'

/** 行首题号：支持 "1." "1、" "第1题" "（1）" "1 " 等常见排版 */
const QUESTION_START_RE = /^\s*(?:第\s*)?(\d{1,3})\s*(?:[.．、,，)）]|[ 　]+题|题)?\s*(?=[^\d\s]|$)/

export interface TextBlock { no: number; text: string }
export interface Anchor { no: number; start: number; end: number }

/**
 * 在全文中寻找题号锚点。
 *
 * 做法：
 * 1. 收集「1~3 位数字 + 标点」候选，先剔除年份/小数/页码/推广串数字等伪锚点；
 * 2. 按文本顺序分段：题号递增（允许跳号）归入当前段；题号大幅回落且新号很小
 *    （如 42 → 2）视为新部分开始，另起一段；其余噪声候选丢弃；
 * 3. 所有长度≥2 的段合并为锚点集，避免「必须从 1 开始」的假设。
 */
export function findQuestionAnchors(text: string): Anchor[] {
  const candidates: Anchor[] = []
  // 标点后允许空格：真实 OCR 是「42. 知识和信息」，(?=\S) 会整批漏掉这类锚点
  const re = /(\d{1,3})\s*[.．、,，)）](?=\s*\S)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const no = Number(match[1])
    if (no < 1 || no > 300) continue
    const end = match.index + match[0].length
    const after = text.slice(end, end + 8).trimStart()
    const before = text.slice(Math.max(0, match.index - 4), match.index)
    // 年份 / 小数 / 单位量词
    if (/^(?:年|月|日|%|亿元?|万|千|周岁|岁|分|秒)/.test(after)) continue
    if (/^\d/.test(after)) continue
    // 页码 "第 11 页"、推广串 "biguo368"
    if (/第\s*$/.test(before) && /^页/.test(after)) continue
    if (/[A-Za-z]$/.test(before)) continue
    const start = match[0].startsWith(match[1]) ? match.index : match.index + 1
    candidates.push({ no, start, end })
  }
  if (candidates.length < 2) return []

  const segments: Anchor[][] = []
  let segment: Anchor[] = [candidates[0]]
  for (let i = 1; i < candidates.length; i += 1) {
    const prev = segment[segment.length - 1]
    const cur = candidates[i]
    const gap = cur.start - prev.end
    const ascending = cur.no > prev.no && cur.no - prev.no <= 24 && gap >= 0 && gap <= 3200
    // 题号重置：从大序号回落到小序号（新部分/新题型开卷）
    const reset = cur.no < prev.no && cur.no <= 8 && prev.no >= 20 && gap >= 0 && gap <= 3200
    if (ascending) {
      segment.push(cur)
    } else if (reset) {
      if (segment.length >= 1) segments.push(segment)
      segment = [cur]
    }
  }
  // 重置后的单题段（如新部分只有一道题）同样是有效题号，必须保留
  if (segment.length >= 1) segments.push(segment)
  return segments.flat().sort((a, b) => a.start - b.start)
}

/** 按题号把全文拆成单题块 */
export function splitByQuestionNumbers(text: string): TextBlock[] {
  const normalized = text.replace(/\r/g, '')
  const anchors = findQuestionAnchors(normalized)

  if (anchors.length >= 2) {
    // 第一个锚点前的文本需先判定是否为真正的共用材料，
    // 试卷封面（水印/密封线/注意事项）会被 sanitizeSharedMaterial 整体丢弃
    const blocks: TextBlock[] = []
    const material = sanitizeSharedMaterial(normalized.slice(0, anchors[0].start))
    for (let i = 0; i < anchors.length; i += 1) {
      const start = anchors[i].end
      const end = i + 1 < anchors.length ? anchors[i + 1].start : normalized.length
      let body = normalized.slice(start, end).trim()
      if (i === 0 && material) body = `【共用材料】${material}\n\n【题目】${body}`
      if (body) blocks.push({ no: anchors[i].no, text: body })
    }
    return blocks
  }

  // 回退：按行首题号切分。不再强制题号从 1 开始——扫描片段常从 42 题起手。
  const lines = normalized.split('\n')
  const blocks: TextBlock[] = []
  let current: TextBlock | null = null
  let expected = 1
  for (const line of lines) {
    const match = line.match(QUESTION_START_RE)
    const no = match ? Number(match[1]) : 0
    const questionLike = /[？?：:]|下列|以下|属于|不属于|正确|错误|填入|依次|填入画横线/.test(line)
    const looksLikeQuestion = no >= 1 && no <= 300 && line.trim().length > 3
      && (no <= expected + 2 || questionLike)
    if (looksLikeQuestion) {
      if (current) blocks.push(current)
      current = { no, text: line.replace(QUESTION_START_RE, '').trim() }
      expected = no + 1
    } else if (current) {
      current.text += '\n' + line
    }
  }
  if (current && current.text.trim()) blocks.push(current)
  return blocks.filter((block) => block.text.trim().length > 0)
}

/** 提取答案表：如 "答案：1.D 2.B 3.C" 或末尾 "1.D 2.B"，按题号回填 */
export function extractAnswerKey(text: string): Map<number, string> {
  const map = new Map<number, string>()
  const tail = text.match(/(?:参考|正确|标准)?\s*答案\s*(?:表)?\s*[:：]?\s*([\s\S]{0,1200})$/i)
  const scope = tail ? tail[1] : text
  const re = /(?:^|[^\d])(\d{1,3})\s*[.．、:：]\s*([A-Da-dＡ-Ｄ])(?=$|[^\u4e00-\u9fa5\w])/g
  let match: RegExpExecArray | null
  while ((match = re.exec(scope)) !== null) {
    const no = Number(match[1])
    if (no >= 1 && no <= 300) map.set(no, match[2].toUpperCase())
  }
  return map
}

/** 规整题干排版：去每行题号、把挤在一起的 (一)(二) 分段、合并被拆碎的短行 */
export function formatStem(stem: string): string {
  const lines = stem
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => stripQuestionNumber(line).replace(/^[.．、,，)）]\s+(?=\S)/, ''))
    .filter(Boolean)
  // 长段中把「（一）」「(四)」等小标题提前换行，避免整段挤成一行
  const expanded = lines.flatMap((line) => line
    .replace(/([。！？；])\s*(?=[（(][一二三四五六七八九十\d]+[）)])/g, '$1\n')
    .split('\n'))
  // 合并被 PDF 提取拆碎的短行（上一行不以句末标点结尾则拼接）
  const merged: string[] = []
  for (const line of expanded) {
    const prev = merged[merged.length - 1]
    if (prev && !/[。！？；：.!?;:]$/.test(prev) && line.length < 26 && !/^[（(]/.test(line)) {
      merged[merged.length - 1] = prev + line
    } else {
      merged.push(line)
    }
  }
  return merged.join('\n').trim()
}

/** 用规则把单题文本解析为 QuizQuestion */
export function ruleParseBlock(block: TextBlock, answerKey: Map<number, string>): QuizQuestion | null {
  // 共用材料段与题目段分开解析：材料里的 "D." "（四）" 等不应被当作选项
  const materialSplit = block.text.indexOf('【题目】')
  const material = materialSplit >= 0 ? block.text.slice(0, materialSplit).replace('【共用材料】', '').trim() : ''
  const body = materialSplit >= 0 ? block.text.slice(materialSplit + '【题目】'.length).trim() : block.text
  const parsed = parseQuestionText(body)
  let answer = parsed.answer
  if (!answer) answer = answerKey.get(block.no) ?? ''
  if (!parsed.stem || parsed.stem.length < 4) return null
  // 统一后处理：去题号/选项字母前缀（规则结果同样带 "1." "A." 前缀）
  const refined = refineAtomicQuestion({ stem: parsed.stem, options: parsed.options, answer, analysis: '', type: '其他' })
  const stem = material ? `【共用材料】${material}\n\n【题目】${refined.stem}` : refined.stem
  return {
    id: uid(),
    title: formatStem(stem),
    options: refined.options,
    answer: refined.answer,
    analysis: '',
    type: '其他',
  }
}

/** 规则全流程：提取答案表 → 切题 → 单题结构化 */
export function ruleParseAll(text: string): QuizQuestion[] {
  const answerKey = extractAnswerKey(text)
  const blocks = splitByQuestionNumbers(text)
  const questions = blocks
    .map((block) => ruleParseBlock(block, answerKey))
    .filter((item): item is QuizQuestion => Boolean(item))
  // 若题号切分失败，退化为「整篇当作一道题」并去掉空选项
  if (questions.length === 0 && text.trim()) {
    const single = ruleParseBlock({ no: 1, text }, answerKey)
    if (single) questions.push(single)
  }
  return questions
}
