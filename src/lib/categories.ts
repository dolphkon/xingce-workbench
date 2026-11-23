/**
 * 公考模块分类配置（模块 → 题型 → 考点）。
 * 首次使用时种子化默认模块；之后完全由用户自定义增删，并随 categories store 跨设备同步。
 */
import { listAll, put, remove, readCachedAll } from './db'
import { DEFAULT_CATEGORIES, type Mistake, type MotherQuestion, type QuestionCategory } from '../types'
import { uid } from './utils'

/** 同步读取（首帧渲染用）；为空时不在此写入，由 ensureCategories 异步种子化 */
export function readCategories(): QuestionCategory[] {
  return readCachedAll('categories').sort((a, b) => a.createdAt - b.createdAt)
}

/** 首次访问时写入默认模块。仅当本地缓存和数据库都没有分类时执行。 */
export async function ensureCategories(): Promise<QuestionCategory[]> {
  const cached = readCachedAll('categories')
  const all = cached.length ? cached : await listAll('categories')
  if (all.length === 0) {
    const now = Date.now()
    const seeds: QuestionCategory[] = DEFAULT_CATEGORIES.map((item, index) => ({
      id: uid(),
      name: item.name,
      types: [...item.types],
      points: [...item.points],
      createdAt: now + index,
      updatedAt: now + index,
    }))
    await Promise.all(seeds.map((item) => put('categories', item)))
    return seeds.sort((a, b) => a.createdAt - b.createdAt)
  }
  return cached.length ? cached.sort((a, b) => a.createdAt - b.createdAt) : all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function saveCategory(category: QuestionCategory): Promise<void> {
  await put('categories', { ...category, updatedAt: Date.now() })
}

export async function deleteCategory(id: string): Promise<void> {
  await remove('categories', id)
}

/** 按 id 找模块；找不到时用名称兜底（兼容旧数据只有 type 名称的情况） */
export function findCategoryById(categories: QuestionCategory[], id?: string): QuestionCategory | undefined {
  if (!id) return undefined
  return categories.find((c) => c.id === id)
}

export function findCategoryByName(categories: QuestionCategory[], name?: string): QuestionCategory | undefined {
  if (!name) return undefined
  return categories.find((c) => c.name === name)
}

/** 与某道错题关联的母题：优先手动 motherId，否则按考点相同自动关联 */
export function relatedMothers(mistake: Mistake, mothers: MotherQuestion[]): MotherQuestion[] {
  if (mistake.motherId) {
    const manual = mothers.filter((m) => m.id === mistake.motherId)
    if (manual.length) return manual
  }
  const point = mistake.point?.trim()
  if (!point) return []
  return mothers.filter((m) => m.point?.trim() === point)
}

/** 与某母题关联的错题：按考点相同（兼容旧 motherId 指向） */
export function relatedMistakes(mother: MotherQuestion, mistakes: Mistake[]): Mistake[] {
  const point = mother.point?.trim()
  return mistakes.filter((m) => (point && m.point?.trim() === point) || m.motherId === mother.id)
}
