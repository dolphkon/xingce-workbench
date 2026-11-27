/**
 * 错题 ↔ 题库后台 双向同步工具。
 *
 * 错题库录入/编辑错题时，自动把同一道题同步写入 `bank` store：
 * - 新建：生成新的题库记录 ID，回写错题的 bankId；
 * - 编辑：按 bankId 更新原题库记录，保留题库记录的 createdAt，避免重复入库；
 * - 从题库推送过来的错题：初始 bankId 就是原题库记录 ID，保存后更新原记录。
 */
import { getById, put } from './db'
import { formatQuestionText } from './utils'
import { plainToRichText, richTextToPlain, sanitizeRichHtml } from './richText'
import { BANK_MODULES, type BankCategory, type BankQuestion, type Mistake } from '../types'

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

/** 同步错题到题库后台，返回实际使用的题库记录 ID */
export async function syncMistakeToBank(mistake: Mistake, bankId?: string): Promise<string> {
  const id = bankId ?? mistake.bankId ?? mistake.id
  const existing = (await getById('bank', id)) as BankQuestion | undefined
  const question = mistakeToBankQuestion({ ...mistake, bankId: id }, existing)
  await put('bank', question)
  return id
}
