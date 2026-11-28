/**
 * 错题 ↔ 题库后台 双向同步工具。
 *
 * 错题库录入/编辑错题时，自动把同一道题同步写入 `bank` store：
 * - 新建：生成新的题库记录 ID，回写错题的 bankId；
 * - 编辑：按 bankId 更新原题库记录，保留题库记录的 createdAt，避免重复入库；
 * - 从题库推送过来的错题：初始 bankId 就是原题库记录 ID，保存后更新原记录。
 */
import { getById, put } from './db'
import { formatQuestionText, questionCategory, splitQuizTitle, uid } from './utils'
import { plainToRichText, richTextToPlain, sanitizeRichHtml } from './richText'
import { BANK_MODULES, type BankCategory, type BankQuestion, type Mistake, type QuizQuestion } from '../types'

/** 把错题转成题库题目；existing 用于编辑时保留题库记录创建时间 */
export function mistakeToBankQuestion(mistake: Mistake, existing?: BankQuestion): BankQuestion {
  const now = Date.now()
  const safeHtml = sanitizeRichHtml(mistake.materialHtml || plainToRichText(formatQuestionText(mistake.material || '')))
  const cleanAnswer = mistake.answer.trim().toUpperCase().replace(/[^A-D]/g, '')
  const category: BankCategory = mistake.category ?? (cleanAnswer.length > 1 ? '多选题' : '单选题')
  const module = mistake.module && BANK_MODULES.includes(mistake.module as (typeof BANK_MODULES)[number])
    ? mistake.module
    : (BANK_MODULES.includes(mistake.type as (typeof BANK_MODULES)[number]) ? mistake.type : BANK_MODULES[0])
  return {
    id: mistake.bankId ?? existing?.id ?? mistake.id,
    category: cleanAnswer.length > 1 ? '多选题' : category,
    module,
    material: richTextToPlain(safeHtml),
    materialHtml: safeHtml || undefined,
    stem: formatQuestionText(mistake.title),
    options: mistake.options.map((o) => formatQuestionText(o)),
    answer: cleanAnswer,
    analysis: formatQuestionText(mistake.analysis),
    source: mistake.source?.trim() || undefined,
    images: mistake.images,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

/** 把试卷题转成题库题目，供「编辑题库」弹窗预填；existing 用于保留题库原 ID 与创建时间 */
export function quizToBankQuestion(q: QuizQuestion, existing?: BankQuestion): BankQuestion {
  const { material, stem } = splitQuizTitle(q.title)
  const cleanAnswer = q.answer.trim().toUpperCase().replace(/[^A-D]/g, '')
  const isModule = (value?: string) => Boolean(value && BANK_MODULES.includes(value as (typeof BANK_MODULES)[number]))
  const now = Date.now()
  return {
    id: existing?.id ?? uid(),
    category: questionCategory(cleanAnswer),
    module: isModule(q.type) ? q.type : (isModule(existing?.module) ? existing!.module : BANK_MODULES[0]),
    material,
    stem: formatQuestionText(stem),
    options: q.options.map((o) => formatQuestionText(o)),
    answer: cleanAnswer,
    analysis: formatQuestionText(q.analysis || ''),
    source: existing?.source || '在线试卷拆题',
    images: q.images ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
}

/** 把题库编辑结果回写为试卷题，保留试卷题 ID 与套卷模板上下文 */
export function bankQuestionToQuiz(b: BankQuestion, base?: QuizQuestion): QuizQuestion {
  return {
    id: base?.id ?? b.id,
    title: b.material ? `【共用材料】${b.material}【题目】${b.stem}` : b.stem,
    options: b.options,
    answer: b.answer,
    analysis: b.analysis,
    type: b.module,
    subType: base?.subType,
    point: base?.point,
    images: b.images,
    section: base?.section,
    page: base?.page,
    favorite: base?.favorite,
  }
}

/** 同步错题到题库后台，返回实际使用的题库记录 ID */
export async function syncMistakeToBank(mistake: Mistake, bankId?: string): Promise<string> {
  const id = bankId ?? mistake.bankId ?? mistake.id
  const existing = (await getById('bank', id)) as BankQuestion | undefined
  const question = mistakeToBankQuestion({ ...mistake, bankId: id }, existing)
  await put('bank', question)
  return id
}
