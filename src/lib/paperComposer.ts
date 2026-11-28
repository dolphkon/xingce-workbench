/**
 * 智能组卷：从在线题库与错题库按四种模式抽题生成套卷。
 *
 * - full    全真模拟：整库按原卷题号顺序取全部题
 * - chapter 章节练习：指定模块 + 题量
 * - random  随机练习：指定题量，并尽量保证每个已选模块的最少题数
 * - mistake 错题重练：错题库中未掌握/掌握中的题，可按模块与题量筛选
 *
 * 生成的 Paper 与文档解析出的试卷完全同构，直接复用 PaperExamRunner 答题。
 */
import { uid } from './utils'
import type { BankQuestion, Mistake, Paper, QuizQuestion } from '../types'

export type ComposeMode = 'full' | 'chapter' | 'random' | 'mistake'

export const COMPOSE_LABEL: Record<ComposeMode, string> = {
  full: '全真模拟',
  chapter: '章节练习',
  random: '随机练习',
  mistake: '错题重练',
}

export interface ComposeOptions {
  mode: ComposeMode
  /** chapter / random / mistake 生效；为空表示全部模块 */
  modules?: string[]
  limit?: number
  /** random 模式每个模块至少抽多少题 */
  perModuleMin?: number
  title?: string
}

export interface ComposeDistribution {
  name: string
  count: number
}

export interface ComposeResult {
  questions: QuizQuestion[]
  distribution: ComposeDistribution[]
  error?: string
  paper?: Paper
}

/** Fisher-Yates 洗牌，返回新数组 */
export function shuffle<T>(input: T[]): T[] {
  const copy = [...input]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** 题库题 → 可作答的试卷题，保留题号/二级题型/来源页/图片说明 */
export function bankToQuiz(item: BankQuestion): QuizQuestion {
  return {
    id: item.id,
    title: item.material ? `【共用材料】${item.material}\n【题目】${item.stem}` : item.stem,
    options: item.options,
    answer: item.answer,
    analysis: item.analysis,
    type: item.module,
    subType: item.subModule,
    subModule: item.subModule,
    hasImage: item.hasImage ?? item.images.length > 0,
    imageNote: item.imageNote,
    no: item.no,
    section: item.module,
    page: item.sourcePage,
    images: item.images,
  }
}

/** 错题 → 可作答的试卷题 */
export function mistakeToQuiz(item: Mistake, index: number): QuizQuestion {
  return {
    id: item.id,
    title: item.material ? `【共用材料】${item.material}\n【题目】${item.title}` : item.title,
    options: item.options,
    answer: item.answer,
    analysis: item.analysis,
    type: item.module || item.type,
    subType: item.subType,
    subModule: item.subType,
    hasImage: item.images.length > 0,
    no: index + 1,
    images: item.images,
  }
}

function distributionOf(questions: QuizQuestion[]): ComposeDistribution[] {
  const counts = new Map<string, number>()
  questions.forEach((question) => {
    const name = question.type || '综合'
    counts.set(name, (counts.get(name) ?? 0) + 1)
  })
  return Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

function matchModules(module: string, selected: string[]): boolean {
  return !selected.length || selected.includes(module)
}

/** 从题库/错题库抽题；返回的题目顺序即为最终试卷顺序 */
export function composeQuestions(
  bank: BankQuestion[],
  mistakes: Mistake[],
  options: ComposeOptions,
): ComposeResult {
  const selected = (options.modules ?? []).filter(Boolean)
  const limit = Math.max(1, Math.floor(options.limit ?? 20))
  const mode = options.mode

  if (mode === 'mistake') {
    const pool = mistakes
      .filter((item) => (item.reviewStatus ?? 'unmastered') !== 'mastered')
      .filter((item) => matchModules(item.module || item.type, selected))
    if (!pool.length) return { questions: [], distribution: [], error: '没有符合条件的错题，可调整模块或先做几套题。' }
    const questions = shuffle(pool).slice(0, limit).map((item, index) => mistakeToQuiz(item, index))
    return { questions, distribution: distributionOf(questions) }
  }

  const pool = bank.filter((item) => matchModules(item.module, selected))
  if (!pool.length) {
    return {
      questions: [],
      distribution: [],
      error: bank.length ? '所选模块没有题目，请更换模块。' : '在线题库还是空的：先在题库管理页上传文档或图片识别入库。',
    }
  }

  if (mode === 'full') {
    const questions = [...pool]
      .sort((a, b) => (a.no ?? 0) - (b.no ?? 0) || a.createdAt - b.createdAt)
      .map(bankToQuiz)
    return { questions, distribution: distributionOf(questions) }
  }

  if (mode === 'chapter') {
    const questions = shuffle(pool).slice(0, limit).map(bankToQuiz)
    return { questions, distribution: distributionOf(questions) }
  }

  // random：先按模块保底，再从剩余题目中补齐，最后整体打乱
  const minPerModule = Math.max(0, Math.floor(options.perModuleMin ?? 0))
  const groups = new Map<string, BankQuestion[]>()
  pool.forEach((item) => {
    const name = item.module || '综合'
    groups.set(name, [...(groups.get(name) ?? []), item])
  })
  const chosen: BankQuestion[] = []
  const used = new Set<string>()
  if (minPerModule > 0) {
    groups.forEach((items) => {
      shuffle(items).slice(0, minPerModule).forEach((item) => {
        if (chosen.length < limit && !used.has(item.id)) { chosen.push(item); used.add(item.id) }
      })
    })
  }
  if (chosen.length < limit) {
    const rest = shuffle(pool.filter((item) => !used.has(item.id)))
    rest.slice(0, limit - chosen.length).forEach((item) => {
      chosen.push(item)
      used.add(item.id)
    })
  }
  const questions = shuffle(chosen).map(bankToQuiz)
  return { questions, distribution: distributionOf(questions) }
}

/** 组卷并组装为可直接保存的 Paper */
export function composePaper(
  bank: BankQuestion[],
  mistakes: Mistake[],
  options: ComposeOptions,
): ComposeResult {
  const result = composeQuestions(bank, mistakes, options)
  if (result.error || !result.questions.length) return result
  const date = new Date().toISOString().slice(0, 10)
  const moduleText = (options.modules ?? []).length ? (options.modules ?? []).join('、') : '全部模块'
  const title = options.title?.trim() || ({
    full: `全真模拟卷 · ${date}`,
    chapter: `${moduleText} 章节练习 · ${date}`,
    random: `随机练习 ${result.questions.length} 题 · ${date}`,
    mistake: `错题重练 ${result.questions.length} 题 · ${date}`,
  })[options.mode]
  const now = Date.now()
  return {
    ...result,
    paper: {
      id: uid(),
      title,
      fileName: '',
      fileType: 'application/x-composed',
      questions: result.questions,
      questionCount: result.questions.length,
      parseMethod: `智能组卷 · ${COMPOSE_LABEL[options.mode]}`,
      createdAt: now,
      updatedAt: now,
    },
  }
}
