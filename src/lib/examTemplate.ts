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
  normalizeMarkdown, questionToBlock, ruleMarkdownToQuestions,
} from './markdownFlow'
import { ruleParseAll } from './paperSplit'

export interface TemplatePage {
  no: number
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
  sections: string[]
  pages: TemplatePage[]
  /** 是否存在显式页标记；false 表示旧格式（整篇一页） */
  paged: boolean
}

const SECTION_RE = /^##\s+(第[一二三四五六七八九十\d]+部分.*|第[一二三四五六七八九十\d]+章.*)$/
const PAGE_RE = /^###\s*第?\s*(\d{1,3})\s*页\s*$|^<!--\s*PAGE\s*[:：]?\s*(\d{1,3})\s*-->/i
const QUESTION_RE = /^#{2,4}\s*第?\s*\d{1,3}\s*题/

/** 解析套卷模板，得到部分/页/题的层级结构 */
export function parseExamTemplate(md: string): ExamTemplate {
  const lines = normalizeMarkdown(md).split('\n')
  const pages: TemplatePage[] = []
  const sections: string[] = []
  let title = ''
  let section = ''
  const state: { current: TemplatePage | null } = { current: null }
  let questionIndex = 0
  let paged = false

  const ensurePage = (no: number, lineIndex: number): TemplatePage => {
    if (state.current) state.current.endLine = lineIndex
    const existing = pages.find((p) => p.no === no)
    if (existing) { state.current = existing; return existing }
    const page: TemplatePage = {
      no, section, body: '', questionIndexes: [], startLine: lineIndex, endLine: lines.length,
    }
    pages.push(page)
    state.current = page
    return page
  }

  lines.forEach((line, index) => {
    const titleMatch = line.match(/^#\s+(?!#)(.+)$/)
    if (titleMatch && !title) { title = titleMatch[1].trim(); return }
    const sectionMatch = line.match(SECTION_RE)
    if (sectionMatch) {
      section = sectionMatch[1].trim()
      if (!sections.includes(section)) sections.push(section)
      return
    }
    const pageMatch = line.match(PAGE_RE)
    if (pageMatch) {
      paged = true
      ensurePage(Number(pageMatch[1] ?? pageMatch[2]), index)
      return
    }
    if (QUESTION_RE.test(line)) {
      if (!state.current) ensurePage(1, index)
      state.current!.questionIndexes.push(questionIndex)
      questionIndex += 1
    }
  })

  if (!pages.length) ensurePage(1, 0)
  if (state.current) state.current.endLine = lines.length
  pages.forEach((page) => {
    page.body = lines.slice(page.startLine, page.endLine).join('\n').trim()
  })
  // 标题后、第一页前的说明行归入第一页
  if (!paged) {
    const firstQuestionLine = lines.findIndex((line) => QUESTION_RE.test(line))
    if (firstQuestionLine > 0) {
      const prefix = lines.slice(0, firstQuestionLine).filter((line) => line.trim() && !/^#\s/.test(line))
      pages[0].body = [...prefix, pages[0].body].filter(Boolean).join('\n').trim()
    }
  }
  return { title, sections, pages, paged }
}

/** 取某页的正文（不含页标题），用于分页编辑器 */
export function pageEditorBody(page: TemplatePage): string {
  return page.body.replace(/^###\s*第?\s*\d{1,3}\s*页\s*$|^<!--\s*PAGE\s*[:：]?\s*\d{1,3}\s*-->/im, '').trim()
}

/** 把编辑后的单页正文写回全文，其他页原样保留 */
export function updateTemplatePage(md: string, pageNo: number, editedBody: string): string {
  const normalized = normalizeMarkdown(md)
  const lines = normalized.split('\n')
  const template = parseExamTemplate(normalized)
  const page = template.pages.find((p) => p.no === pageNo)
  if (!page) return normalized
  const heading = template.paged ? `### 第 ${pageNo} 页` : ''
  const replacement = [heading, editedBody.trim()].filter(Boolean).join('\n')
  const next = [
    ...lines.slice(0, page.startLine),
    replacement,
    ...lines.slice(page.endLine),
  ].join('\n')
  return normalizeMarkdown(next)
}

/** 给题目附上模板上下文（部分/页），按下标一一对应 */
export function attachTemplateContext(questions: QuizQuestion[], md: string): QuizQuestion[] {
  const template = parseExamTemplate(md)
  const context = new Map<number, { section: string; page: number }>()
  template.pages.forEach((page) => {
    page.questionIndexes.forEach((index) => {
      context.set(index, { section: page.section, page: page.no })
    })
  })
  return questions.map((question, index) => ({
    ...question,
    ...(context.get(index) ?? {}),
  }))
}

/**
 * 把题目按固定模板序列化成套卷。
 * pageTexts 以题号映射方式传入：{ [题目下标]: { page, section } }。
 */
export function renderExamTemplate(
  questions: QuizQuestion[],
  title: string,
  context?: Map<number, { page: number; section: string }>,
): string {
  const parts: string[] = []
  if (title.trim()) parts.push(`# ${title.trim()}`, '')
  let lastSection = ''
  let lastPage = -1
  questions.forEach((question, index) => {
    const page = context?.get(index)?.page ?? 1
    const section = context?.get(index)?.section ?? ''
    if (section && section !== lastSection) {
      parts.push(`## ${section}`, '')
      lastSection = section
      lastPage = -1
    }
    if (page !== lastPage) {
      parts.push(`### 第 ${page} 页`, '')
      lastPage = page
    }
    parts.push(questionToBlock(question, index + 1, '####'), '')
  })
  return normalizeMarkdown(parts.join('\n'))
}

/** 自动排版：按模板上下文重排全部题目，规整字段顺序与分页 */
export function formatExamTemplate(md: string): string {
  const template = parseExamTemplate(md)
  const questions = ruleMarkdownToQuestions(md)
  const context = new Map<number, { page: number; section: string }>()
  template.pages.forEach((page) => {
    page.questionIndexes.forEach((index) => context.set(index, { page: page.no, section: page.section }))
  })
  return renderExamTemplate(questions, template.title, context)
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
