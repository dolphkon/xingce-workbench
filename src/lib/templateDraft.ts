/**
 * 结构化套卷模版草稿。
 *
 * 设计原则：题块边界只由「原文题号锚点」决定，AI 只负责回填字段，
 * 因此无论模型把多少道题写进一个 Markdown 题块，都不会再出现「第 5 题吞十余题」。
 * 编辑器、卷面预览、生成套卷共用这一份对象数据，不再二次解析文本。
 */
import type { QuizQuestion } from '../types'
import { extractAnswerKey, findQuestionAnchors, ruleParseBlock, splitByQuestionNumbers } from './paperSplit'
import {
  extractMarkdownImages, normalizeMarkdown, repairMarkdownTemplate, ruleMarkdownToQuestions,
  splitMarkdownBlocks,
} from './markdownFlow'
import { canonicalSection, parseExamTemplate, renderExamTemplate } from './examTemplate'
import { splitQuizTitle, uid } from './utils'

/** 模版题槽：一道题对应一个稳定 ID，页/部分/题号均可人工调整 */
export interface TemplateQuestion {
  id: string
  no: number
  paper: number
  section: string
  module: string
  page: number
  material: string
  stem: string
  options: string[]
  answer: string
  analysis: string
  images: string[]
  /** 原文锚点文本，用于 AI 回填与误拆时重试 */
  source: string
  origin: 'rule' | 'ai' | 'manual'
}

export interface TemplateDraft {
  title: string
  fileName: string
  fileType: string
  fileData: string
  textMethod: string
  usedOcr: boolean
  usedLlm: boolean
  llmMessage?: string
  /** 清洗后的原文，供「AI 重新填充」复用 */
  rawText: string
  questions: TemplateQuestion[]
}

/** AI 回填项：与题槽按原文题号对齐，不参与题块边界判定 */
export interface TemplateFill {
  no?: number
  module?: string
  material?: string
  stem?: string
  options?: string[]
  answer?: string
  analysis?: string
}

export interface TemplateDraftInput {
  text: string
  pageTexts: string[]
  title: string
  fileName: string
  fileType: string
  fileData: string
  textMethod: string
  usedOcr: boolean
}

const MODULE_PATTERNS: Array<[string, RegExp]> = [
  ['政治理论', /政治理论|马克思主义|毛泽东思想|习近平|党的二十大|辩证唯物/],
  ['常识', /常识判断|法律常识|科技常识|人文常识|自然常识|经济常识/],
  ['言语理解', /言语理解|片段阅读|逻辑填空|语句表达|阅读理解/],
  ['数量关系', /数量关系|数学运算|数字推理/],
  ['判断推理', /判断推理|图形推理|定义判断|类比推理|逻辑判断/],
  ['资料分析', /资料分析|统计图|统计表|资料分析题/],
]

const MODULES = [...MODULE_PATTERNS.map(([name]) => name), '其他']

export function inferModule(text: string): string {
  const value = String(text ?? '')
  for (const [name, re] of MODULE_PATTERNS) if (re.test(value)) return name
  return '其他'
}

export function canonicalModule(value?: string): string {
  const raw = String(value ?? '').trim()
  if (!raw) return '其他'
  if (MODULES.includes(raw)) return raw
  const found = inferModule(raw)
  return found === '其他' ? '其他' : found
}

/** 模块名映射到真实行测套卷的部分标题 */
export function moduleToSection(module: string): string {
  const m = canonicalModule(module)
  if (m === '常识') return '常识判断'
  if (m === '言语理解') return '言语理解与表达'
  return m === '其他' ? '其他' : m
}

function compact(text: string): string {
  return String(text ?? '').replace(/\s+/g, '').slice(0, 160)
}

/** 回填文本里若出现两个以上题号锚点，说明模型又把多题粘在一起，拒绝覆盖题槽 */
export function hasMergedQuestions(text: string): boolean {
  return findQuestionAnchors(String(text ?? '')).length >= 2
}

function normalizeFillOptions(options?: string[]): string[] {
  const values = Array.isArray(options) ? options : []
  const byLetter: Record<string, string> = {}
  values.forEach((value, index) => {
    const text = String(value ?? '').trim()
    const match = text.match(/^([A-Da-d])[.．、:：\s]\s*(.*)$/)
    if (match) byLetter[match[1].toUpperCase()] = match[2].trim()
    else byLetter[String.fromCharCode(65 + index)] = text
  })
  return ['A', 'B', 'C', 'D'].map((letter) => byLetter[letter] ?? '')
}

function makeQuestion(input: {
  no: number
  module: string
  page: number
  material: string
  stem: string
  options: string[]
  answer: string
  analysis: string
  images: string[]
  source: string
  origin: TemplateQuestion['origin']
  id?: string
  section?: string
}): TemplateQuestion {
  const module = canonicalModule(input.module)
  return {
    id: input.id ?? uid(),
    no: input.no,
    paper: 1,
    section: input.section?.trim() || moduleToSection(module),
    module,
    page: Math.max(1, input.page),
    material: input.material.trim(),
    stem: input.stem.trim(),
    options: input.options.map((value) => String(value ?? '').trim()),
    answer: String(input.answer ?? '').toUpperCase().replace(/[^A-D]/g, ''),
    analysis: input.analysis.trim(),
    images: input.images.filter(Boolean),
    source: input.source,
    origin: input.origin,
  }
}

/**
 * 阶段①：文档文本 → 结构化模版草稿。
 * 逐页按题号锚点切题，保证题块边界来自原文而不是模型输出。
 */
export function buildTemplateDraft(input: TemplateDraftInput): TemplateDraft {
  const answerKey = extractAnswerKey(input.text)
  const questions: TemplateQuestion[] = []
  const pages = input.pageTexts.length ? input.pageTexts : [input.text]

  pages.forEach((pageText, pageIndex) => {
    const blocks = splitByQuestionNumbers(pageText)
    const module = inferModule(pageText.slice(0, 3000))
    blocks.forEach((block) => {
      const parsed = ruleParseBlock(block, answerKey)
      if (!parsed) return
      const { material, stem } = splitQuizTitle(parsed.title)
      const images = extractMarkdownImages(block.text).images
      questions.push(makeQuestion({
        no: block.no,
        module,
        page: pageIndex + 1,
        material,
        stem,
        options: parsed.options,
        answer: parsed.answer,
        analysis: parsed.analysis,
        images,
        source: block.text,
        origin: 'rule',
      }))
    })
  })

  if (!questions.length && input.text.trim()) {
    questions.push(makeQuestion({
      no: 1,
      module: inferModule(input.text),
      page: 1,
      material: '',
      stem: input.text,
      options: ['', '', '', ''],
      answer: '',
      analysis: '',
      images: [],
      source: input.text,
      origin: 'rule',
    }))
  }

  return {
    title: input.title,
    fileName: input.fileName,
    fileType: input.fileType,
    fileData: input.fileData,
    textMethod: input.textMethod,
    usedOcr: input.usedOcr,
    usedLlm: false,
    rawText: input.text,
    questions,
  }
}

/**
 * 阶段②：把 AI 回填结果按「原文题号」对齐到题槽。
 * 同一部分题号重置时按出现顺序配对；同一题号重复时按题干锚点二次确认。
 */
export function applyTemplateFill(draft: TemplateDraft, fills: TemplateFill[]): TemplateDraft {
  if (!fills?.length) return draft
  const questions = draft.questions.map((question) => ({ ...question }))
  const byNo = new Map<number, number[]>()
  questions.forEach((question, index) => {
    const list = byNo.get(question.no) ?? []
    list.push(index)
    byNo.set(question.no, list)
  })
  const used = new Set<number>()

  const locate = (fill: TemplateFill): number => {
    const candidates = (byNo.get(Number(fill.no)) ?? []).filter((index) => !used.has(index))
    if (candidates.length) return candidates[0]
    const key = compact(fill.stem ?? '').slice(0, 14)
    if (key.length >= 6) {
      const matched = questions.findIndex((question, index) => !used.has(index)
        && (compact(question.stem).includes(key) || compact(question.source).includes(key)))
      if (matched >= 0) return matched
    }
    return -1
  }

  fills.forEach((fill) => {
    const index = locate(fill)
    if (index < 0) return
    used.add(index)
    const question = questions[index]
    const module = canonicalModule(fill.module || question.module)
    question.module = module
    question.section = moduleToSection(module)
    // 模型把多题塞进一个字段时保留原有边界，宁可信息少也不要重新粘连
    if (!hasMergedQuestions(fill.stem ?? '') && (fill.stem?.trim().length ?? 0) >= 4) question.stem = fill.stem!.trim()
    if (!hasMergedQuestions(fill.material ?? '') && fill.material?.trim()) question.material = fill.material!.trim()
    const options = normalizeFillOptions(fill.options)
    if (options.some(Boolean)) question.options = options
    const answer = String(fill.answer ?? '').toUpperCase().replace(/[^A-D]/g, '')
    if (answer) question.answer = answer
    if (fill.analysis?.trim()) question.analysis = fill.analysis.trim()
    question.origin = 'ai'
  })

  return { ...draft, questions, usedLlm: true }
}

/** 人工拆分被误粘的题槽：按原文题号重新切成多题 */
export function splitTemplateQuestion(draft: TemplateDraft, id: string): TemplateDraft {
  const index = draft.questions.findIndex((question) => question.id === id)
  if (index < 0) return draft
  const question = draft.questions[index]
  const source = [question.source, question.material, question.stem].filter(Boolean).join('\n')
  const blocks = splitByQuestionNumbers(source)
  if (blocks.filter((block) => /[？?]|[：:]/.test(block.text)).length < 2) return draft
  const answerKey = extractAnswerKey(draft.rawText)
  const splits = blocks.map((block, offset) => {
    const parsed = ruleParseBlock(block, answerKey)
    const { material, stem } = parsed ? splitQuizTitle(parsed.title) : { material: '', stem: block.text }
    return makeQuestion({
      id: offset === 0 ? question.id : uid(),
      no: block.no,
      module: question.module,
      section: question.section,
      page: question.page,
      material,
      stem,
      options: parsed?.options ?? ['', '', '', ''],
      answer: parsed?.answer ?? '',
      analysis: '',
      images: extractMarkdownImages(block.text).images,
      source: block.text,
      origin: 'manual',
    })
  })
  return {
    ...draft,
    questions: [...draft.questions.slice(0, index), ...splits, ...draft.questions.slice(index + 1)],
  }
}

/** 供编辑器使用的稳定分组：部分 → 页 */
export interface TemplateGroup {
  key: string
  section: string
  page: number
  ids: string[]
}

export function templateGroups(draft: TemplateDraft): TemplateGroup[] {
  const groups: TemplateGroup[] = []
  draft.questions.forEach((question) => {
    const key = `${question.section}|${question.page}`
    let group = groups.find((item) => item.key === key)
    if (!group) {
      group = { key, section: question.section, page: question.page, ids: [] }
      groups.push(group)
    }
    group.ids.push(question.id)
  })
  return groups
}

export function templateStats(draft: TemplateDraft): { sections: number; pages: number; questions: number } {
  const groups = templateGroups(draft)
  return {
    sections: new Set(groups.map((group) => group.section)).size,
    pages: new Set(draft.questions.map((question) => question.page)).size,
    questions: draft.questions.length,
  }
}

/** 结构化草稿 → 试卷题目（不再经过 Markdown 二次解析） */
export function draftToQuestions(draft: TemplateDraft): QuizQuestion[] {
  return draft.questions.map((question) => ({
    id: question.id,
    title: question.material
      ? `【共用材料】${question.material}\n【题目】${question.stem}`
      : question.stem,
    options: question.options,
    answer: question.answer,
    analysis: question.analysis,
    type: question.module,
    section: canonicalSection(question.section, question.module),
    page: question.page,
    images: question.images,
  }))
}

/** 导出标准套卷 Markdown，供下载与旧流程兼容 */
export function draftToMarkdown(draft: TemplateDraft): string {
  return renderExamTemplate(
    draftToQuestions(draft),
    draft.title,
    undefined,
    draft.questions.map((question) => question.no),
  )
}

function questionModule(type: string): string {
  return String(type ?? '').replace(/[·•]?\s*(?:单选题|多选题)\s*$/, '').trim()
}

/** 旧 Markdown 导入：转成同样的结构化题槽，接回新编辑器 */
export function markdownToDraft(markdown: string, meta: Partial<TemplateDraft> = {}): TemplateDraft {
  const fixed = repairMarkdownTemplate(markdown)
  const template = parseExamTemplate(fixed)
  const blocks = splitMarkdownBlocks(fixed)
  const questions = ruleMarkdownToQuestions(fixed)
  const context = new Map<number, { section: string; page: number }>()
  template.pages.forEach((page) => {
    page.questionIndexes.forEach((index) => context.set(index, { section: page.section, page: page.no }))
  })

  const slots = questions.map((question, index) => {
    const { material, stem } = splitQuizTitle(question.title)
    const module = canonicalModule(questionModule(question.type))
    const ctx = context.get(index)
    return makeQuestion({
      no: blocks[index]?.no ?? index + 1,
      module,
      section: ctx?.section || moduleToSection(module),
      page: ctx?.page ?? 1,
      material,
      stem,
      options: question.options,
      answer: question.answer,
      analysis: question.analysis,
      images: question.images ?? [],
      source: blocks[index]?.body ?? question.title,
      origin: 'rule',
    })
  })

  return {
    title: template.title || meta.title || '',
    fileName: meta.fileName ?? '',
    fileType: meta.fileType ?? '',
    fileData: meta.fileData ?? '',
    textMethod: meta.textMethod ?? 'Markdown 导入',
    usedOcr: meta.usedOcr ?? false,
    usedLlm: meta.usedLlm ?? false,
    llmMessage: meta.llmMessage,
    rawText: fixed,
    questions: slots,
  }
}

/** 供编辑器只读展示的规范化文本 */
export function normalizeTemplateText(text: string): string {
  return normalizeMarkdown(text)
}
