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
import { structureQuestions, type LlmQuestion } from './llm'
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
  /** 原始文本（便于人工核对） */
  rawText: string
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

/** 题号起始行：支持 "1." "1、" "第1题" "（1）" "1 " 等常见排版 */
const QUESTION_START_RE = /^\s*(?:第\s*)?(\d{1,3})\s*(?:[.．、,，)）]|[ 　]+题|题)?\s*(?=[^\d\s]|$)/

interface TextBlock { no: number; text: string }

function splitByQuestionNumbers(text: string): TextBlock[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: TextBlock[] = []
  let current: TextBlock | null = null
  let expected = 1

  for (const line of lines) {
    const match = line.match(QUESTION_START_RE)
    const no = match ? Number(match[1]) : 0
    // 接受与预期接近的递增题号，避免把选项编号/年份误判为新题
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

/** 用规则把单题文本解析为 QuizQuestion */
function ruleParseBlock(block: TextBlock): QuizQuestion | null {
  const parsed = parseQuestionText(block.text)
  if (!parsed.stem || parsed.stem.length < 4) return null
  return {
    id: uid(),
    title: parsed.stem.replace(/^\d+[.．、]\s*/, '').trim(),
    options: parsed.options,
    answer: parsed.answer,
    analysis: '',
    type: '其他',
  }
}

function ruleParseAll(text: string): QuizQuestion[] {
  const blocks = splitByQuestionNumbers(text)
  const questions = blocks.map(ruleParseBlock).filter((item): item is QuizQuestion => Boolean(item))
  // 若题号切分失败，退化为「整篇当作一道题」并去掉空选项
  if (questions.length === 0 && text.trim()) {
    const single = ruleParseBlock({ no: 1, text })
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
    if (!rule) return question
    const options = question.options.map((option, i) => option.trim() || rule.options[i]?.trim() || '')
    const answer = question.answer || rule.answer || ''
    // 题干明显过短时以规则题干为准（规则保留原文更完整）
    const title = question.title.length < 8 && rule.title.length > question.title.length ? rule.title : question.title
    return { ...question, title, options, answer }
  }).filter((question) => question.title.trim().length > 0)
}

/* -------------------------------------------------------------------------- */
/* 主流程                                                                      */
/* -------------------------------------------------------------------------- */

export interface ParseOptions {
  /** 是否禁用大模型（GitHub Pages 域名自动禁用） */
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

  // 规则解析先行：既作为 LLM 不可用时的兜底，也作为 LLM 结果的校验依据
  onProgress({ percent: 68, stage: 'rules', message: '正在按题号拆分题目…' })
  const rules = ruleParseAll(text)

  let llm: LlmQuestion[] = []
  let usedLlm = false
  if (!options.disableLlm) {
    try {
      onProgress({ percent: 76, stage: 'llm', message: '正在智能结构化题目…' })
      llm = await structureQuestions(text, options.signal)
      usedLlm = llm.length > 0
    } catch {
      // 大模型不可用/额度不足时静默回退到规则解析
      llm = []
    }
  }

  onProgress({ percent: 92, stage: 'rules', message: '正在校验并合并结果…' })
  const questions = mergeResults(llm, rules)
  if (questions.length === 0) {
    throw new Error('未识别到有效题目。请在文档中按「1. 题干 / A. 选项 / 答案：X」的格式排布后重试')
  }

  const methodParts = [textMethod]
  if (usedOcr) methodParts.push('OCR 回退')
  if (usedLlm) methodParts.push('大模型结构化')
  methodParts.push('规则校验')

  onProgress({ percent: 100, stage: 'done', message: `识别完成，共 ${questions.length} 道题` })
  return { questions, method: methodParts.join(' + '), usedLlm, usedOcr, rawText: text }
}
