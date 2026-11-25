/**
 * 公考模块分类配置（模块 → 题型 → 考点）。
 * 首次使用时种子化默认模块；之后完全由用户自定义增删，并随 categories store 跨设备同步。
 */
import { listAll, put, remove, readCachedAll } from './db'
import { DEFAULT_CATEGORIES, type Mistake, type MotherQuestion, type QuestionCategory } from '../types'

/** 合并两份题型考点映射，考点去重 */
function mergeTypePoints(a?: Record<string, string[]>, b?: Record<string, string[]>): Record<string, string[]> | undefined {
  if (!a && !b) return undefined
  const result: Record<string, string[]> = {}
  for (const [type, points] of Object.entries({ ...(a ?? {}), ...(b ?? {}) })) {
    result[type] = Array.from(new Set(points))
  }
  return result
}

/**
 * 同名模块去重：早期并发种子化 / 跨设备同步可能产生多条同名分类。
 * 保留最早创建的记录，合并其题型与考点，其余记录由 ensureCategories 清理。
 */
function normalizeCategories(list: QuestionCategory[]): { items: QuestionCategory[]; duplicates: string[] } {
  const sorted = [...list].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const byName = new Map<string, QuestionCategory>()
  const duplicates: string[] = []
  sorted.forEach((item) => {
    const name = item.name.trim()
    const key = name || item.id
    const kept = byName.get(key)
    if (!kept) {
      byName.set(key, { ...item, name, types: [...item.types], points: [...item.points], typePoints: item.typePoints ? { ...item.typePoints } : undefined })
      return
    }
    duplicates.push(item.id)
    kept.types = Array.from(new Set([...kept.types, ...item.types]))
    kept.points = Array.from(new Set([...kept.points, ...item.points]))
    kept.typePoints = mergeTypePoints(kept.typePoints, item.typePoints)
    kept.updatedAt = Math.max(kept.updatedAt, item.updatedAt)
  })
  return { items: Array.from(byName.values()), duplicates }
}

/** 预置模块补上默认题型考点映射（不修改入参） */
function withDefaultTypePoints(item: QuestionCategory): QuestionCategory {
  if (item.typePoints) return item
  const seed = DEFAULT_CATEGORIES.find((s) => s.name === item.name)
  return seed?.typePoints ? { ...item, typePoints: { ...seed.typePoints } } : item
}

/** 同步读取（首帧渲染用）；同名记录即时去重，不在此写库 */
export function readCategories(): QuestionCategory[] {
  return normalizeCategories(readCachedAll('categories')).items
    .map(withDefaultTypePoints)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** 种子模块使用固定 id，避免多标签页 / 多设备同时初始化时产生重复记录 */
let seeding: Promise<QuestionCategory[]> | null = null

/** 首次访问时写入默认模块；同时清理历史同名重复记录 */
export async function ensureCategories(): Promise<QuestionCategory[]> {
  if (seeding) return seeding
  seeding = doEnsureCategories().finally(() => { seeding = null })
  return seeding
}

async function doEnsureCategories(): Promise<QuestionCategory[]> {
  const cached = readCachedAll('categories')
  let current = cached.length ? cached : await listAll('categories')
  if (current.length === 0) {
    const now = Date.now()
    const seeds: QuestionCategory[] = DEFAULT_CATEGORIES.map((item, index) => ({
      id: `seed-category-${index + 1}`,
      name: item.name,
      types: [...item.types],
      points: [...item.points],
      ...(item.typePoints ? { typePoints: { ...item.typePoints } } : {}),
      createdAt: now + index,
      updatedAt: now + index,
    }))
    await Promise.all(seeds.map((item) => put('categories', item)))
    current = seeds
  }
  const { items, duplicates } = normalizeCategories(current)
  // 老数据升级：预置模块补上「题型 → 考点」映射，已有自定义映射则保留
  let migrated = false
  for (let i = 0; i < items.length; i++) {
    const enriched = withDefaultTypePoints(items[i])
    if (enriched !== items[i]) {
      items[i] = enriched
      migrated = true
    }
  }
  if (duplicates.length > 0 || migrated) {
    // 先把合并/升级后的记录写回，再删除多余记录，避免清理过程中数据缺失
    await Promise.all(items.map((item) => put('categories', item)))
    await Promise.all(duplicates.map((id) => remove('categories', id)))
  }
  return items.sort((a, b) => a.createdAt - b.createdAt)
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

/** 某题型下可选的考点：优先使用模块内配置的题型映射，未配置时沿用模块全部考点 */
export function pointsForType(category?: QuestionCategory, subType?: string): string[] {
  if (!category) return []
  const key = subType?.trim()
  if (key && category.typePoints && Object.prototype.hasOwnProperty.call(category.typePoints, key)) {
    return category.typePoints[key] ?? []
  }
  return category.points ?? []
}

/** 与某道错题关联的母题：优先手动 motherId，否则按考点相同自动关联；关闭关联开关后一律不关联 */
export function relatedMothers(mistake: Mistake, mothers: MotherQuestion[]): MotherQuestion[] {
  if (mistake.linkMother === false) return []
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
  return mistakes.filter((m) => m.linkMother !== false && ((point && m.point?.trim() === point) || m.motherId === mother.id))
}
