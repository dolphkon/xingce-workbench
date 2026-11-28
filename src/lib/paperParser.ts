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
import {
  probeLlm, structureQuestions, generateMarkdown, structureMarkdown,
  type LlmBlockReason, type LlmQuestion, type LlmProgress,
} from './llm'
import { cleanExamText, stripResidualBoilerplate } from './examClean'
import { findQuestionAnchors, formatStem, ruleParseAll } from './paperSplit'
import {
  ruleTextToMarkdown, ruleMarkdownToQuestions, mergeMarkdownWithRules,
} from './markdownFlow'
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
  const boilerplateSuspected = /(?:复制必备|复制必究|版权所有|密封线|条形码|监考老师|注意事项|重要提示|请按照要求在答题卡|biguo\d{3,})/i.test(question.title)
  return {
    missingAnswer,
    incompleteOptions,
    tooLongStem,
    boilerplateSuspected,
    needsReview: missingAnswer || incompleteOptions || tooLongStem || boilerplateSuspected,
  }
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

/** 用规则结果校验/补全 LLM 结果：LLM 缺失选项或答案时用规则结果补齐 */
function mergeResults(llm: LlmQuestion[], rules: QuizQuestion[]): QuizQuestion[] {
  const clean = (q: QuizQuestion): QuizQuestion => ({
    ...q,
    title: formatStem(stripResidualBoilerplate(q.title)),
  })

  // LLM 题数少于规则 → 判定为漏题/多题粘连（OCR 乱序下模型常把一两道题吞掉），
  // 此时规则按题号切分的结果更完整，直接以规则为准。阈值 1.2 兼顾偶尔的规则过切。
  if (llm.length && rules.length > llm.length * 1.2) {
    return rules.map(clean)
  }

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
    // 二次校验：单道题的题干里仍含多个题号锚点 → LLM 粘连，改用规则题干
    let resolved = question
    if (rule && findQuestionAnchors(question.title).length > 1) {
      resolved = { ...resolved, title: rule.title }
    }
    if (!rule) return clean(resolved)
    const options = resolved.options.map((option, i) => option.trim() || rule.options[i]?.trim() || '')
    const answer = resolved.answer || rule.answer || ''
    // 题干明显过短时以规则题干为准（规则保留原文更完整）
    const title = resolved.title.length < 8 && rule.title.length > resolved.title.length
      ? rule.title : resolved.title
    return clean({ ...resolved, title, options, answer })
  }).filter((question) => question.title.trim().length > 0)
}

/** 阶段①结果：结构化 Markdown 中间稿 */
export interface MarkdownDraft {
  markdown: string
  /** AI 是否真正参与生成（false 表示规则兜底） */
  usedLlm: boolean
  llmReason?: LlmBlockReason
  llmMessage?: string
  rawText: string
  textMethod: string
  usedOcr: boolean
}

/**
 * 两阶段拆题 · 阶段①：清洗后的文本 → 结构化 Markdown 中间稿。
 * AI 优先；能力不可用或调用失败时用规则切题结果拼 Markdown 兜底，保证 GitHub Pages 也能走通流程。
 */
export async function textToMarkdown(
  extracted: ExtractResult,
  onProgress: ProgressFn = noop,
  options: ParseOptions = {},
): Promise<MarkdownDraft> {
  const { text, textMethod, usedOcr } = extracted
  let markdown = ''
  let usedLlm = false
  let llmReason: LlmBlockReason | undefined
  let llmMessage: string | undefined

  const probe = await probeLlm()
  if (!options.disableLlm && probe.available) {
    try {
      onProgress({ percent: 66, stage: 'llm', message: '正在用大模型整理 Markdown…' })
      markdown = await generateMarkdown(text, options.signal, (p: LlmProgress) => {
        onProgress({ percent: Math.min(92, 66 + Math.round(p.fraction * 26)), stage: 'llm', message: p.message })
      })
      if (markdown) {
        onProgress({ percent: 93, stage: 'rules', message: '正在用规则校验题目完整性…' })
        markdown = mergeMarkdownWithRules(markdown, text)
      }
      usedLlm = markdown.length > 0
    } catch (err) {
      const typed = err as Error & { reason?: LlmBlockReason }
      llmReason = typed.reason ?? 'unknown'
      llmMessage = typed.message || 'AI 整理失败，已用规则生成 Markdown'
    }
  } else if (!options.disableLlm) {
    llmReason = probe.reason
    llmMessage = probe.message
  }

  if (!markdown) {
    onProgress({ percent: 84, stage: 'rules', message: '正在用规则生成 Markdown…' })
    markdown = ruleTextToMarkdown(text)
  }
  if (!markdown) throw new Error('未能生成 Markdown 中间稿，请确认文档中包含「1. 题干 / A. 选项」格式的试题')

  onProgress({ percent: 100, stage: 'done', message: 'Markdown 中间稿已生成，请人工校验排版' })
  return { markdown, usedLlm, llmReason, llmMessage, rawText: text, textMethod, usedOcr }
}

/** 两阶段拆题 · 阶段②结果 */
export interface MarkdownParseDraft {
  questions: QuizQuestion[]
  usedLlm: boolean
  llmReason?: LlmBlockReason
  llmMessage?: string
}

/**
 * 两阶段拆题 · 阶段②：人工校验后的 Markdown → 待确认题目。
 * 同样 AI 优先、规则兜底；mergeResults 用规则补全 AI 缺失字段并二次校验粘连。
 */
export async function markdownToQuestions(
  markdown: string,
  onProgress: ProgressFn = noop,
  options: ParseOptions = {},
): Promise<MarkdownParseDraft> {
  const rules = ruleMarkdownToQuestions(markdown)
  let llm: LlmQuestion[] = []
  let usedLlm = false
  let llmReason: LlmBlockReason | undefined
  let llmMessage: string | undefined

  const probe = await probeLlm()
  if (!options.disableLlm && probe.available) {
    try {
      onProgress({ percent: 62, stage: 'llm', message: '正在用大模型解析 Markdown…' })
      llm = await structureMarkdown(markdown, options.signal, (p) => {
        onProgress({ percent: Math.min(92, 62 + Math.round(p.fraction * 30)), stage: 'llm', message: p.message })
      })
      usedLlm = llm.length > 0
    } catch (err) {
      const typed = err as Error & { reason?: LlmBlockReason }
      llmReason = typed.reason ?? 'unknown'
      llmMessage = typed.message || 'AI 解析失败，已用规则解析 Markdown'
    }
  } else if (!options.disableLlm) {
    llmReason = probe.reason
    llmMessage = probe.message
  }

  onProgress({ percent: 94, stage: 'rules', message: '正在校验并合并结果…' })
  const questions = mergeResults(llm, rules)
  if (questions.length === 0) throw new Error('未能从 Markdown 中解析出题目，请检查「## 第 N 题」与选项格式')

  onProgress({ percent: 100, stage: 'done', message: `解析完成，共 ${questions.length} 道题` })
  return { questions, usedLlm, llmReason, llmMessage }
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

export interface ExtractResult {
  text: string
  textMethod: string
  usedOcr: boolean
}

/**
 * 阶段零：只做「文档 → 清洗后文本」，不涉及切题。
 * 两阶段流程（文本→Markdown→题目）与原有直拆流程共用这段提取逻辑。
 */
export async function extractDocumentText(
  fileData: string,
  fileName: string,
  fileType: string,
  onProgress: ProgressFn = noop,
  options: ParseOptions = {},
): Promise<ExtractResult> {
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

  onProgress({ percent: 60, stage: 'prepare', message: '正在清理试卷版式噪音…' })
  text = cleanExamText(text)
  return { text, textMethod, usedOcr }
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

  const extracted = await extractDocumentText(fileData, fileName, fileType, onProgress, options)
  const { text, textMethod, usedOcr } = extracted

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
