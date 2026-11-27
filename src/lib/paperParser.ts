/**
 * 文档 → 题库 解析引擎。
 * 为保证识别准确性，采用多方式综合策略：
 *   1) 文本层优先：PDF 用 pdfjs-dist 抽文本；Word 用 mammoth 抽纯文本；
 *   2) OCR 回退：扫描版 PDF（无文本层）逐页渲染后用 tesseract 中文识别；
 *   3) LLM 结构化：WorkBuddy 域名免密钥大模型把全文拆成题目 JSON；
 *   4) 规则校验/兜底：正则切题 + 单题解析，校验或补全 LLM 结果。
 * 最终按题号合并去重，输出可直接用于在线刷题的 QuizQuestion[]。
 */
import type { QuizQuestion } from '../types'
import { extractPdfText, renderPdfPages } from './pdfText'
import { recognizeImage } from './ocr'
import { parseQuestionText } from './ocr'
import { probeLlm, structureQuestions, type LlmBlockReason, type LlmQuestion } from './llm'
import { cleanExamText, sanitizeSharedMaterial, stripResidualBoilerplate } from './examClean'
import { uid } from './utils'

export type ParseStage = 'prepare' | 'text' | 'ocr' | 'llm' | 'rules' | 'done'

export interface ParseProgress {
  percent: number
  stage: ParseStage
  message: string
}

export interface ParseResult {
  questions: QuizQuestion[]
  /** 识别方式说明，写入试卷元数据 */
  method: string
  /** 是否使用了大模型 */
  usedLlm: boolean
  /** 是否使用了 OCR */
  usedOcr: boolean
  /** 大模型未启用时的降级原因（供 UI 精确提示） */
  llmReason?: LlmBlockReason
  llmMessage?: string
  /** 原始文本（便于人工核对） */
  rawText: string
}

/** 单题的识别置信信息，供人工审核时优先关注 */
export interface QuestionConfidence {
  /** 答案是否未识别 */
  missingAnswer: boolean
  /** 选项是否不足四个 */
  incompleteOptions: boolean
  /** 题干是否过长（疑似多题粘连未切开） */
  tooLongStem: boolean
  /** 题干是否残留试卷版式噪音（水印/密封线/注意事项） */
  boilerplateSuspected: boolean
  /** 是否需要人工确认 */
  needsReview: boolean
}

/** 判断一道题哪些字段不确定，需要人工审核 */
export function inspectQuestion(question: QuizQuestion): QuestionConfidence {
  const missingAnswer = !question.answer.trim()
  const filled = question.options.filter((option) => option.trim()).length
  const incompleteOptions = filled > 0 && filled < 4
  // 题干超过 280 字且选项不完整，多半是题号漏切导致多题粘连
  const tooLongStem = question.title.length > 280 && (incompleteOptions || missingAnswer)
  // 试卷版式噪音残留检测：提示用户校对时重点清理
  const boilerplateSuspected = /(?:复制必备|版权所有|密封线|条形码|监考老师|注意事项|重要提示|请按照要求在答题卡)/.test(question.title)
  return {
    missingAnswer,
    incompleteOptions,
    tooLongStem,
    boilerplateSuspected,
    needsReview: missingAnswer || incompleteOptions || tooLongStem || boilerplateSuspected,
  }
}

/** 规整题干排版：把挤在一起的 (一)(二) 分段、题内换行、选项串拆开后重新分行 */
export function formatStem(stem: string): string {
  const lines = stem
    .replace(/\r/g, '')
    .split('\n')
    // 去掉题号切片后残留在行首的孤立标点（如 "2. 2023年…" 被切成 ". 2023年…"）
    .map((line) => line.trim().replace(/^[.．、,，)）]\s+(?=\S)/, ''))
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

type ProgressFn = (progress: ParseProgress) => void
const noop: ProgressFn = () => undefined

/** 识别文件类型 */
export function parseFileKind(fileName: string, fileType: string): 'pdf' | 'docx' | 'unsupported' {
  const lower = fileName.toLowerCase()
  const ext = (lower.split('.').pop() ?? '').trim()
  if (ext === 'pdf' || fileType === 'application/pdf') return 'pdf'
  if (ext === 'docx' || fileType.includes('wordprocessingml')) return 'docx'
  return 'unsupported'
}

/** DataURL → ArrayBuffer */
function decodeDataUrl(dataUrl: string): ArrayBuffer | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const meta = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (/;base64/i.test(meta)) {
    try {
      const binary = atob(payload.replace(/\s/g, ''))
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return bytes.buffer
    } catch { return null }
  }
  try { return new TextEncoder().encode(decodeURIComponent(payload)).buffer } catch { return null }
}

/** Word 纯文本提取（mammoth extractRawText） */
async function extractDocxText(dataUrl: string): Promise<string> {
  const buffer = decodeDataUrl(dataUrl)
  if (!buffer) throw new Error('Word 文档解码失败')
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ arrayBuffer: buffer })
  return result.value || ''
}

/* -------------------------------------------------------------------------- */
/* 规则切题：按题号把全文拆成单题块                                            */
/* -------------------------------------------------------------------------- */

/** 行首题号：支持 "1." "1、" "第1题" "（1）" "1 " 等常见排版 */
const QUESTION_START_RE = /^\s*(?:第\s*)?(\d{1,3})\s*(?:[.．、,，)）]|[ 　]+题|题)?\s*(?=[^\d\s]|$)/

interface TextBlock { no: number; text: string }
interface Anchor { no: number; start: number; end: number }

/**
 * 在全文中寻找题号锚点。常见 PDF/网页提取会把题号挤在句中，例如
 * "…127.2020年夏粮产量…128.2020年小麦产量…"，单纯按行首切分会整篇粘连。
 * 这里收集「题号+标点」候选（如 127.），再用最长递增子序列排除年份、小数、
 * 材料序号等噪声（年份后跟"年"、小数后跟数字，都不匹配本正则）。
 */
function findQuestionAnchors(text: string): Anchor[] {
  const candidates: Anchor[] = []
  const re = /(\d{1,3})\s*[.．、,，)）](?=\S)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    candidates.push({ no: Number(match[1]), start: match.index, end: match.index + match[0].length })
  }
  if (candidates.length < 2) return []

  const n = candidates.length
  const dp = new Array<number>(n).fill(1)
  const prev = new Array<number>(n).fill(-1)
  for (let i = 1; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const from = candidates[j]
      const to = candidates[i]
      const gap = to.start - from.end
      // 题号递增、位置递增、间隔合理，避免把小数/年份串成伪序列
      if (from.no < to.no && to.no - from.no <= 12 && gap >= 0 && gap <= 1600 && dp[j] + 1 > dp[i]) {
        dp[i] = dp[j] + 1
        prev[i] = j
      }
    }
  }
  let best = 0
  for (let i = 1; i < n; i += 1) if (dp[i] > dp[best]) best = i
  if (dp[best] < 2) return []
  const chain: number[] = []
  for (let k = best; k >= 0; k = prev[k]) chain.unshift(k)
  return chain.map((i) => candidates[i])
}

function splitByQuestionNumbers(text: string): TextBlock[] {
  const normalized = text.replace(/\r/g, '')
  const anchors = findQuestionAnchors(normalized)

  if (anchors.length >= 2) {
    // 锚点切片：第一个锚点前的文本需先判定是否为真正的共用材料，
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

  // 回退：按行首题号切分
  const lines = normalized.split('\n')
  const blocks: TextBlock[] = []
  let current: TextBlock | null = null
  let expected = 1
  for (const line of lines) {
    const match = line.match(QUESTION_START_RE)
    const no = match ? Number(match[1]) : 0
    const looksLikeQuestion = no > 0 && no <= expected + 2 && line.trim().length > 3
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
function extractAnswerKey(text: string): Map<number, string> {
  const map = new Map<number, string>()
  const tail = text.match(/(?:参考)?答案\s*[:：]?\s*([\s\S]{0,800})$/i)
  const scope = tail ? tail[1] : text
  const re = /(?:^|[^\d])(\d{1,3})\s*[.．、]\s*([A-Da-dＡ-Ｄ])(?=$|[^\u4e00-\u9fa5\w])/g
  let match: RegExpExecArray | null
  while ((match = re.exec(scope)) !== null) {
    const no = Number(match[1])
    if (no >= 1 && no <= 300) map.set(no, match[2].toUpperCase())
  }
  return map
}

/** 用规则把单题文本解析为 QuizQuestion */
function ruleParseBlock(block: TextBlock, answerKey: Map<number, string>): QuizQuestion | null {
  // 共用材料段与题目段分开解析：材料里的 "D." "（四）" 等不应被当作选项
  const materialSplit = block.text.indexOf('【题目】')
  const material = materialSplit >= 0 ? block.text.slice(0, materialSplit).replace('【共用材料】', '').trim() : ''
  const body = materialSplit >= 0 ? block.text.slice(materialSplit + '【题目】'.length).trim() : block.text
  const parsed = parseQuestionText(body)
  let answer = parsed.answer
  if (!answer) answer = answerKey.get(block.no) ?? ''
  if (!parsed.stem || parsed.stem.length < 4) return null
  const stem = material ? `【共用材料】${material}\n\n【题目】${parsed.stem}` : parsed.stem
  return {
    id: uid(),
    title: formatStem(stem),
    options: parsed.options,
    answer,
    analysis: '',
    type: '其他',
  }
}

function ruleParseAll(text: string): QuizQuestion[] {
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

/** 用规则结果校验/补全 LLM 结果：LLM 缺失选项或答案时用规则结果补齐 */
function mergeResults(llm: LlmQuestion[], rules: QuizQuestion[]): QuizQuestion[] {
  const source = llm.length ? llm.map((item) => ({
    id: uid(),
    title: item.stem,
    options: item.options,
    answer: item.answer,
    analysis: item.analysis,
    type: item.type || '其他',
  })) : rules

  return source.map((question, index) => {
    const rule = rules[index]
    if (!rule) {
      return { ...question, title: formatStem(stripResidualBoilerplate(question.title)) }
    }
    const options = question.options.map((option, i) => option.trim() || rule.options[i]?.trim() || '')
    const answer = question.answer || rule.answer || ''
    // 题干明显过短时以规则题干为准（规则保留原文更完整）
    const title = question.title.length < 8 && rule.title.length > question.title.length ? rule.title : question.title
    // 二次兜底：清掉 LLM/规则输出里残留的试卷版式噪音行
    return { ...question, title: formatStem(stripResidualBoilerplate(title)), options, answer }
  }).filter((question) => question.title.trim().length > 0)
}

/* -------------------------------------------------------------------------- */
/* 主流程                                                                      */
/* -------------------------------------------------------------------------- */

export interface ParseOptions {
  /** 是否强制禁用大模型（默认否；可用性以运行时探测为准） */
  disableLlm?: boolean
  /** OCR 最大页数 */
  maxOcrPages?: number
  signal?: AbortSignal
}

export async function parseDocumentToQuestions(
  fileData: string,
  fileName: string,
  fileType: string,
  onProgress: ProgressFn = noop,
  options: ParseOptions = {},
): Promise<ParseResult> {
  const kind = parseFileKind(fileName, fileType)
  if (kind === 'unsupported') throw new Error('仅支持 PDF 或 Word（.docx）文档')

  onProgress({ percent: 8, stage: 'prepare', message: '正在读取文档…' })

  let text = ''
  let usedOcr = false
  let textMethod = ''

  if (kind === 'pdf') {
    onProgress({ percent: 18, stage: 'text', message: '正在提取 PDF 文本层…' })
    const pdf = await extractPdfText(fileData)
    text = pdf.text
    textMethod = 'PDF 文本层'
    // 文本层覆盖不足（疑似扫描版）→ OCR 回退
    if (pdf.textPages === 0 || text.trim().length < 40) {
      onProgress({ percent: 30, stage: 'ocr', message: 'PDF 无文本层，正在 OCR 识别…' })
      usedOcr = true
      const pages = await renderPdfPages(fileData, options.maxOcrPages ?? 20)
      const ocrParts: string[] = []
      for (let i = 0; i < pages.length; i += 1) {
        if (options.signal?.aborted) throw new Error('已取消')
        onProgress({
          percent: 30 + Math.round(((i + 1) / pages.length) * 35),
          stage: 'ocr',
          message: `正在 OCR 识别第 ${i + 1}/${pages.length} 页…`,
        })
        ocrParts.push(await recognizeImage(pages[i]))
      }
      text = ocrParts.join('\n\n')
      textMethod = 'PDF 逐页 OCR'
    }
  } else {
    onProgress({ percent: 22, stage: 'text', message: '正在提取 Word 文本…' })
    text = await extractDocxText(fileData)
    textMethod = 'Word 文本层'
  }

  if (!text.trim()) throw new Error('未能从文档中提取到文字，请确认文档内容或改用可复制文本的版本')

  // 文本清洗：移除试卷封面水印、密封线、条形码说明、注意事项等版式噪音，
  // 避免它们被规则切题当成「共用材料」或被 LLM 当成题干背景
  onProgress({ percent: 60, stage: 'prepare', message: '正在清理试卷版式噪音…' })
  text = cleanExamText(text)

  // 运行时探测大模型能力（不再用域名硬编码判断）
  onProgress({ percent: 64, stage: 'llm', message: '正在检测智能拆题能力…' })
  const probe = await probeLlm()
  const llmEnabled = !options.disableLlm && probe.available

  // 规则解析先行：既作为 LLM 不可用时的兜底，也作为 LLM 结果的校验依据
  onProgress({ percent: 68, stage: 'rules', message: '正在按题号拆分题目…' })
  const rules = ruleParseAll(text)

  let llm: LlmQuestion[] = []
  let usedLlm = false
  let llmReason: LlmBlockReason | undefined
  let llmMessage: string | undefined
  if (llmEnabled) {
    try {
      onProgress({ percent: 76, stage: 'llm', message: '正在用大模型智能拆题…' })
      llm = await structureQuestions(text, options.signal, (p) => {
        // 用连续 fraction 映射到 76~91 区间：token 级进度让进度条持续前进，不再卡死
        const pct = 76 + Math.round(p.fraction * 15)
        onProgress({ percent: Math.min(91, pct), stage: 'llm', message: p.message })
      })
      usedLlm = llm.length > 0
    } catch (err) {
      llm = []
      const typed = err as Error & { reason?: LlmBlockReason }
      llmReason = typed.reason ?? 'unknown'
      llmMessage = typed.message || '智能拆题暂不可用，已自动改用规则拆题'
    }
  } else if (!options.disableLlm) {
    llmReason = probe.reason
    llmMessage = probe.message
  }

  onProgress({ percent: 92, stage: 'rules', message: '正在校验并合并结果…' })
  const questions = mergeResults(llm, rules)
  if (questions.length === 0) {
    throw new Error('未识别到有效题目。请在文档中按「1. 题干 / A. 选项 / 答案：X」的格式排布后重试')
  }

  const methodParts = [textMethod]
  if (usedOcr) methodParts.push('OCR 回退')
  if (usedLlm) methodParts.push('大模型智能拆题')
  else methodParts.push('规则拆题')
  methodParts.push('人工校对')

  onProgress({ percent: 100, stage: 'done', message: `识别完成，共 ${questions.length} 道题` })
  return {
    questions, method: methodParts.join(' + '), usedLlm, usedOcr,
    llmReason, llmMessage, rawText: text,
  }
}
