/**
 * 套卷固定模板中间层。
 *
 * 模板层级（模拟真实试卷，按页加载）：
 *   # 试卷名称
 *   ## 第一部分 言语理解与表达
 *   ### 第 1 页
 *   #### 第 1 题
 *   题型：单选题
 *   模块：言语理解
 *   材料：
 *   题干：
 *   A. / B. / C. / D.
 *   答案：
 *   解析：
 *
 * 兼容旧格式：没有「## 第X部分」「### 第 N 页」时，整篇视为第 1 页；
 * 题块标题接受 ## / ### / #### 三种层级，解析结果不受影响。
 */
import type { QuizQuestion } from '../types'
import {
  normalizeMarkdown, questionToBlock, ruleMarkdownToQuestions, splitMarkdownBlocks,
  QUESTION_HEADING_RE, SECTION_HEADING_RE, PAGE_HEADING_RE,
} from './markdownFlow'
import { ruleParseAll } from './paperSplit'

export interface TemplatePage {
  no: number
  /** 同一 PDF 可能含多套卷，每套卷页码会从 1 重新开始；paper 用于区分 */
  paper: number
  /** 分页唯一键：paper:no */
  id: string
  /** 该套卷标题 */
  paperTitle: string
  /** 所属部分名称，如「第一部分 言语理解与表达」 */
  section: string
  /** 该页完整 Markdown 文本（含页标题） */
  body: string
  /** 该页题目在全文题目序列中的下标 */
  questionIndexes: number[]
  /** 在全文中的起止行，供分页回写 */
  startLine: number
  endLine: number
}

export interface ExamTemplate {
  title: string
  /** 文档中出现的所有套卷标题（多套卷时长度 > 1） */
  papers: string[]
  sections: string[]
  pages: TemplatePage[]
  /** 是否存在显式页标记；false 表示旧格式（整篇一页） */
  paged: boolean
}

const MODULE_TO_SECTION: Record<string, string> = {
  常识: '常识判断',
  政治理论: '政治理论',
  言语理解: '言语理解与表达',
  数量关系: '数量关系',
  判断推理: '判断推理',
  资料分析: '资料分析',
}

const SECTION_KEYWORDS: Record<string, string[]> = {
  常识: ['常识', '政治理论', '法律', '人文', '科技', '自然'],
  政治理论: ['政治', '理论', '常识'],
  言语理解: ['言语', '阅读', '表达', '逻辑填空', '片段阅读'],
  数量关系: ['数量', '数学运算', '数字推理'],
  判断推理: ['判断', '推理', '图形', '定义', '类比', '逻辑判断'],
  资料分析: ['资料', '材料', '统计图', '统计表'],
}

function questionModule(question: QuizQuestion): string {
  return question.type.replace(/[·•]?\s*(?:单选题|多选题)\s*$/, '').trim()
}

/** 模块是人工校验后的权威字段，部分标题与之冲突时按模块纠正 */
export function canonicalSection(section: string, module: string): string {
  const m = String(module ?? '').trim()
  if (!m) return String(section ?? '').trim()
  const canonical = MODULE_TO_SECTION[m] ?? m
  const s = String(section ?? '').trim()
  if (!s) return canonical
  const keywords = SECTION_KEYWORDS[m] ?? [m]
  if (keywords.some((keyword) => s.includes(keyword))) return s
  const prefix = s.match(/^第[一二三四五六七八九十百\d]+(?:部分|章|篇)/)?.[0]
  return prefix ? `${prefix} ${canonical}` : canonical
}

/** 解析套卷模板，得到套卷/部分/页/题的层级结构 */
export function parseExamTemplate(md: string): ExamTemplate {
  const lines = normalizeMarkdown(md).split('\n')
  const pages: TemplatePage[] = []
  const sections: string[] = []
  const papers: string[] = []
  let title = ''
  let paperTitle = ''
  let section = ''
  let paperIndex = 1
  /** 新套卷标题行：其后的部分/页标题都应归入该套卷的第一页 */
  let paperStartLine = 0
  const state: { current: TemplatePage | null } = { current: null }
  let questionIndex = 0
  let paged = false
  let currentQuestion = -1
  const questionModules: string[] = []

  const ensurePage = (no: number, lineIndex: number, startLineOverride?: number): TemplatePage => {
    if (state.current) state.current.endLine = lineIndex
    const existing = pages.find((p) => p.paper === paperIndex && p.no === no)
    if (existing) {
      if (startLineOverride !== undefined) existing.startLine = Math.min(existing.startLine, startLineOverride)
      state.current = existing
      return existing
    }
    const page: TemplatePage = {
      no,
      paper: paperIndex,
      id: `${paperIndex}:${no}`,
      paperTitle,
      section,
      body: '',
      questionIndexes: [],
      startLine: startLineOverride ?? lineIndex,
      endLine: lines.length,
    }
    pages.push(page)
    state.current = page
    return page
  }

  lines.forEach((line, index) => {
    const titleMatch = line.match(/^[ \t]*#[ \t]+(?!#)(.+)$/)
    if (titleMatch) {
      const name = titleMatch[1].trim()
      if (!title && !pages.length) {
        title = name
        paperTitle = name
        papers.push(name)
      } else {
        // 同一 PDF 拼接了多套卷：新标题开启新的 paper，页码从 1 重新计数也不会并页
        paperIndex += 1
        if (state.current) state.current.endLine = index
        paperTitle = name
        section = ''
        state.current = null
        paperStartLine = index
        papers.push(name)
      }
      return
    }
    const sectionMatch = line.match(SECTION_HEADING_RE)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      if (!sections.includes(section)) sections.push(section)
      return
    }
    const pageMatch = line.match(PAGE_HEADING_RE)
    if (pageMatch) {
      paged = true
      const hasPaperPage = pages.some((p) => p.paper === paperIndex)
      ensurePage(Number(pageMatch[1] ?? pageMatch[2]), index, hasPaperPage ? undefined : paperStartLine)
      return
    }
    if (QUESTION_HEADING_RE.test(line)) {
      if (!state.current) ensurePage(1, index, paperStartLine)
      state.current!.questionIndexes.push(questionIndex)
      questionModules.push('')
      currentQuestion = questionIndex
      questionIndex += 1
      return
    }
    const moduleMatch = line.match(/^[ \t]*(?:[-*][ \t]*)?模块[ \t]*[:：][ \t]*(.*)$/)
    if (moduleMatch && currentQuestion >= 0) {
      questionModules[currentQuestion] = moduleMatch[1].trim()
    }
  })

  if (!pages.length) ensurePage(1, 0, paperStartLine)
  if (state.current) state.current.endLine = lines.length
  pages.forEach((page) => {
    page.body = lines.slice(page.startLine, page.endLine).join('\n').trim()
  })
  // 标题后、第一页前的说明行归入第一页
  if (!paged) {
    const firstQuestionLine = lines.findIndex((line) => QUESTION_HEADING_RE.test(line))
    if (firstQuestionLine > 0) {
      const prefix = lines.slice(0, firstQuestionLine).filter((line) => line.trim() && !/^#{1,8}[ \t]/.test(line))
      pages[0].body = [...prefix, pages[0].body].filter(Boolean).join('\n').trim()
    }
  }
  // 人工校验后「模块」优先：纠正部分标题，保证目录与题目归属一致
  pages.forEach((page) => {
    const module = page.questionIndexes.map((i) => questionModules[i]).find(Boolean) ?? ''
    if (module) page.section = canonicalSection(page.section, module)
  })
  sections.length = 0
  pages.forEach((page) => {
    if (page.section && !sections.includes(page.section)) sections.push(page.section)
  })
  return { title, papers, sections, pages, paged }
}

/** 取某页的正文（不含页标题），用于分页编辑器 */
export function pageEditorBody(page: TemplatePage): string {
  return page.body.replace(PAGE_HEADING_RE, '').trim()
}

/** 把编辑后的单页正文写回全文，其他页原样保留；pageKey 支持数字页码或多套卷的 `paper:no` */
export function updateTemplatePage(md: string, pageKey: string | number, editedBody: string): string {
  const normalized = normalizeMarkdown(md)
  const lines = normalized.split('\n')
  const template = parseExamTemplate(normalized)
  const page = typeof pageKey === 'number'
    ? template.pages.find((p) => p.no === pageKey)
    : template.pages.find((p) => p.id === pageKey)
  if (!page) return normalized
  const heading = template.paged ? `### 第 ${page.no} 页` : ''
  const replacement = [heading, editedBody.trim()].filter(Boolean).join('\n')
  const next = [
    ...lines.slice(0, page.startLine),
    replacement,
    ...lines.slice(page.endLine),
  ].join('\n')
  return normalizeMarkdown(next)
}

export interface TemplateContext {
  section: string
  page: number
  paper?: number
  paperTitle?: string
}

/** 给题目附上模板上下文（套卷/部分/页），按下标一一对应 */
export function attachTemplateContext(questions: QuizQuestion[], md: string): QuizQuestion[] {
  const template = parseExamTemplate(md)
  const context = new Map<number, TemplateContext>()
  template.pages.forEach((page) => {
    page.questionIndexes.forEach((index) => {
      context.set(index, {
        section: page.section, page: page.no, paper: page.paper, paperTitle: page.paperTitle,
      })
    })
  })
  return questions.map((question, index) => {
    const ctx = context.get(index)
    if (!ctx) return question
    return { ...question, page: ctx.page, section: canonicalSection(ctx.section, questionModule(question)) }
  })
}

/**
 * 把题目按固定模板序列化成套卷。
 * context 中可带 paper/paperTitle，用于保留同一 PDF 内多套卷的独立分页。
 */
export function renderExamTemplate(
  questions: QuizQuestion[],
  title: string,
  context?: Map<number, TemplateContext>,
  /** 原题号序列，保证自动排版不把 42/重置题号改成 1、2、3 */
  numbers?: number[],
): string {
  const parts: string[] = []
  const hasPaperContext = Boolean(context && [...context.values()].some((ctx) => ctx.paperTitle))
  if (!hasPaperContext && title.trim()) parts.push(`# ${title.trim()}`, '')
  let lastPaper = 0
  let lastSection = ''
  let lastPage = -1
  questions.forEach((question, index) => {
    const ctx = context?.get(index)
    const paper = ctx?.paper ?? 1
    const paperTitle = ctx?.paperTitle ?? title
    const page = ctx?.page ?? 1
    const section = canonicalSection(ctx?.section ?? '', questionModule(question))
    if (paper !== lastPaper) {
      if (paperTitle.trim()) parts.push(`# ${paperTitle.trim()}`, '')
      lastPaper = paper
      lastSection = ''
      lastPage = -1
    }
    if (section && section !== lastSection) {
      parts.push(`## ${section}`, '')
      lastSection = section
      lastPage = -1
    }
    if (page !== lastPage) {
      parts.push(`### 第 ${page} 页`, '')
      lastPage = page
    }
    parts.push(questionToBlock(question, numbers?.[index] ?? index + 1, '####'), '')
  })
  return normalizeMarkdown(parts.join('\n'))
}

/** 自动排版：按模板上下文重排全部题目，规整字段顺序与分页 */
export function formatExamTemplate(md: string): string {
  const template = parseExamTemplate(md)
  const blocks = splitMarkdownBlocks(md)
  const questions = ruleMarkdownToQuestions(md)
  const context = new Map<number, TemplateContext>()
  template.pages.forEach((page) => {
    page.questionIndexes.forEach((index) => context.set(index, {
      section: page.section, page: page.no, paper: page.paper, paperTitle: page.paperTitle,
    }))
  })
  return renderExamTemplate(questions, template.title, context, blocks.map((block) => block.no))
}

/** 规则兜底：把逐页 OCR 文本整理为套卷模板 */
export function pageTextsToTemplate(pageTexts: string[], title = ''): string {
  const parts: string[] = []
  if (title.trim()) parts.push(`# ${title.trim()}`, '')
  pageTexts.forEach((text, index) => {
    const questions = ruleParseAll(text)
    if (!questions.length) return
    parts.push(`### 第 ${index + 1} 页`, '')
    questions.forEach((question, i) => parts.push(questionToBlock(question, i + 1, '####'), ''))
  })
  return normalizeMarkdown(parts.join('\n'))
}

/** 统计套卷规模：部分数/页数/题数 */
export function templateStats(md: string): { sections: number; pages: number; questions: number } {
  const template = parseExamTemplate(md)
  return {
    sections: template.sections.length,
    pages: template.pages.length,
    questions: template.pages.reduce((sum, page) => sum + page.questionIndexes.length, 0),
  }
}
