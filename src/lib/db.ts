import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { notifySync } from './syncHook'
import type {
  BackupData, BankQuestion, KnowledgeDoc, KnowledgeFolder, Mistake, MotherQuestion, Paper,
  PracticeRecord, QuestionCategory, StudyPlan,
} from '../types'

interface WorkbenchDB extends DBSchema {
  mistakes: {
    key: string
    value: Mistake
    indexes: { 'by-created': number; 'by-type': string }
  }
  docs: {
    key: string
    value: KnowledgeDoc
    indexes: { 'by-updated': number; 'by-category': string }
  }
  mothers: {
    key: string
    value: MotherQuestion
    indexes: { 'by-created': number; 'by-type': string }
  }
  plans: {
    key: string
    value: StudyPlan
    indexes: { 'by-date': string; 'by-module': string }
  }
  categories: {
    key: string
    value: QuestionCategory
    indexes: { 'by-updated': number }
  }
  folders: {
    key: string
    value: KnowledgeFolder
    indexes: { 'by-updated': number }
  }
  papers: {
    key: string
    value: Paper
    indexes: { 'by-updated': number }
  }
  practiceRecords: {
    key: string
    value: PracticeRecord
    indexes: { 'by-updated': number; 'by-paper': string }
  }
  bank: {
    key: string
    value: BankQuestion
    indexes: { 'by-updated': number; 'by-module': string; 'by-category': string }
  }
}

export type StoreName = 'mistakes' | 'docs' | 'mothers' | 'plans' | 'categories' | 'folders' | 'papers' | 'practiceRecords' | 'bank'

export type EntityMap = {
  mistakes: Mistake
  docs: KnowledgeDoc
  mothers: MotherQuestion
  plans: StudyPlan
  categories: QuestionCategory
  folders: KnowledgeFolder
  papers: Paper
  practiceRecords: PracticeRecord
  bank: BankQuestion
}

const DB_NAME = 'xingce-workbench'
const DB_VERSION = 6
const CACHE_PREFIX = 'xingce-cache-v1-'
const DELETED_PREFIX = 'xingce-deleted-v1-'
/** 后台数据库读取的最长等待时间；页面渲染不再依赖它 */
const DB_TIMEOUT = 800

let dbPromise: Promise<IDBPDatabase<WorkbenchDB>> | null = null

function getDB(): Promise<IDBPDatabase<WorkbenchDB>> {
  if (dbPromise) return dbPromise
  try {
    dbPromise = openDB<WorkbenchDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const mistakes = db.createObjectStore('mistakes', { keyPath: 'id' })
          mistakes.createIndex('by-created', 'createdAt')
          mistakes.createIndex('by-type', 'type')

          const docs = db.createObjectStore('docs', { keyPath: 'id' })
          docs.createIndex('by-updated', 'updatedAt')
          docs.createIndex('by-category', 'category')

          const mothers = db.createObjectStore('mothers', { keyPath: 'id' })
          mothers.createIndex('by-created', 'createdAt')
          mothers.createIndex('by-type', 'type')
        }
        if (oldVersion < 2) {
          const plans = db.createObjectStore('plans', { keyPath: 'id' })
          plans.createIndex('by-date', 'date')
          plans.createIndex('by-module', 'module')
        }
        if (oldVersion < 3) {
          const categories = db.createObjectStore('categories', { keyPath: 'id' })
          categories.createIndex('by-updated', 'updatedAt')
        }
        if (oldVersion < 4) {
          const folders = db.createObjectStore('folders', { keyPath: 'id' })
          folders.createIndex('by-updated', 'updatedAt')
        }
        if (oldVersion < 5) {
          const papers = db.createObjectStore('papers', { keyPath: 'id' })
          papers.createIndex('by-updated', 'updatedAt')
          const records = db.createObjectStore('practiceRecords', { keyPath: 'id' })
          records.createIndex('by-updated', 'updatedAt')
          records.createIndex('by-paper', 'paperId')
        }
        if (oldVersion < 6) {
          const bank = db.createObjectStore('bank', { keyPath: 'id' })
          bank.createIndex('by-updated', 'updatedAt')
          bank.createIndex('by-module', 'module')
          bank.createIndex('by-category', 'category')
        }
      },
    }).catch((err) => {
      dbPromise = null
      throw err
    })
    return dbPromise
  } catch (err) {
    // 浏览器禁用 IndexedDB 时返回 rejected promise，调用方已有回退逻辑
    return Promise.reject(err)
  }
}

/* ---------- 内存镜像：同步读写，避免每次操作都 JSON.parse 大对象（图片） ---------- */

interface CacheState<K extends StoreName> {
  items: EntityMap[K][]
  deleted: Set<string>
}

const cacheMap = new Map<StoreName, CacheState<StoreName>>()

function stateOf<K extends StoreName>(store: K): CacheState<K> {
  const existing = cacheMap.get(store)
  if (existing) return existing as CacheState<K>

  let items: EntityMap[K][] = []
  let deleted = new Set<string>()
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${store}`)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) items = parsed as EntityMap[K][]
    const delRaw = window.localStorage.getItem(`${DELETED_PREFIX}${store}`)
    const delParsed: unknown = delRaw ? JSON.parse(delRaw) : []
    if (Array.isArray(delParsed)) {
      deleted = new Set(delParsed.filter((id): id is string => typeof id === 'string'))
    }
  } catch {
    // 存储不可用时从空集合开始，仍可尝试数据库
  }
  const state: CacheState<K> = { items, deleted }
  cacheMap.set(store, state as CacheState<StoreName>)
  return state
}

/** 同步读取集合：页面首帧即可渲染，不等待 IndexedDB */
export function readCachedAll<K extends StoreName>(store: K): EntityMap[K][] {
  const state = stateOf(store)
  return state.items.filter((item) => !state.deleted.has(item.id))
}

/** 同步读取单条：详情页首帧即可渲染 */
export function readCachedById<K extends StoreName>(store: K, id: string): EntityMap[K] | undefined {
  const state = stateOf(store)
  if (state.deleted.has(id)) return undefined
  return state.items.find((item) => item.id === id)
}

function persistCache<K extends StoreName>(store: K, items: EntityMap[K][]): void {
  const state = stateOf(store)
  state.items = items
  try {
    window.localStorage.setItem(`${CACHE_PREFIX}${store}`, JSON.stringify(items))
  } catch {
    // 超出配额时仍保留内存镜像，本次会话内功能正常
  }
}

function persistDeleted(store: StoreName, ids: Iterable<string>): void {
  const state = stateOf(store)
  state.deleted = new Set(ids)
  try {
    window.localStorage.setItem(`${DELETED_PREFIX}${store}`, JSON.stringify(Array.from(state.deleted)))
  } catch {
    // 忽略写失败
  }
}

// 多标签页之间保持缓存同步
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event.key) return
    const match = /^xingce-(?:cache|deleted)-v1-(mistakes|docs|mothers|plans|categories|folders|papers|practiceRecords|bank)$/.exec(event.key)
    if (match) cacheMap.delete(match[1] as StoreName)
  })
}

function withFallback<T>(promise: Promise<T>, ms: number, fallbackValue: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(fallbackValue)
      }
    }, ms)
    promise.then(
      (value) => {
        if (!settled) {
          settled = true
          window.clearTimeout(timer)
          resolve(value)
        }
      },
      () => {
        if (!settled) {
          settled = true
          window.clearTimeout(timer)
          resolve(fallbackValue)
        }
      },
    )
  })
}

/** 后台镜像写：不阻塞界面，失败静默忽略（本地缓存已经是最新数据） */
function mirror(work: (db: IDBPDatabase<WorkbenchDB>) => Promise<unknown>): void {
  void getDB().then(work).catch(() => undefined)
}

/** 后台同步数据库数据到缓存；渲染不等待该过程 */
export async function listAll<K extends StoreName>(store: K): Promise<EntityMap[K][]> {
  const remote = await withFallback(
    getDB().then((db) => db.getAll(store) as Promise<EntityMap[K][]>),
    DB_TIMEOUT,
    [] as EntityMap[K][],
  )
  const map = new Map<string, EntityMap[K]>()
  const deleted = stateOf(store).deleted
  remote.forEach((item) => {
    if (!deleted.has(item.id)) map.set(item.id, item)
  })
  // 重新读取缓存：同步期间的写入不能被后台刷新覆盖
  readCachedAll(store).forEach((item) => {
    const existing = map.get(item.id)
    if (!existing || (item.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) map.set(item.id, item)
  })
  const result = Array.from(map.values()).filter((item) => !stateOf(store).deleted.has(item.id))
  // 数据库未返回数据时缓存本身就是结果，避免重复序列化大对象（含图片）
  if (remote.length === 0) {
    const current = readCachedAll(store)
    if (current.length === result.length && current.every((item) => map.get(item.id) === item)) return current
  }
  persistCache(store, result)
  return result
}

/** 后台读取单条；调用方可先用 readCachedById 立即渲染 */
export async function getById<K extends StoreName>(store: K, id: string): Promise<EntityMap[K] | undefined> {
  const cached = readCachedById(store, id)
  const remote = await withFallback(
    getDB().then((db) => db.get(store, id) as Promise<EntityMap[K] | undefined>),
    DB_TIMEOUT,
    undefined as EntityMap[K] | undefined,
  )
  if (stateOf(store).deleted.has(id)) return undefined
  if (cached && (!remote || (cached.updatedAt ?? 0) >= (remote.updatedAt ?? 0))) return cached
  return remote
}

/** 同步写缓存并立即返回；IndexedDB 写入在后台进行 */
export async function put<K extends StoreName>(store: K, value: EntityMap[K]): Promise<void> {
  const state = stateOf(store)
  persistCache(store, state.items.filter((item) => item.id !== value.id).concat(value))
  if (state.deleted.delete(value.id)) persistDeleted(store, state.deleted)
  mirror((db) => db.put(store, value as WorkbenchDB[K]['value']))
  notifySync(store, value.id, value as unknown as Record<string, unknown>, value.updatedAt ?? 0)
}

/** 同步移除缓存并立即返回；IndexedDB 删除在后台进行 */
export async function remove<K extends StoreName>(store: K, id: string): Promise<void> {
  const state = stateOf(store)
  persistDeleted(store, [...state.deleted, id])
  persistCache(store, state.items.filter((item) => item.id !== id))
  mirror((db) => db.delete(store, id))
  notifySync(store, id, null, Date.now())
}

export async function count(store: StoreName): Promise<number> {
  return (await listAll(store)).length
}

export async function exportAll(): Promise<BackupData> {
  const [mistakes, docs, mothers, plans, categories, folders, papers, practiceRecords, bank] = await Promise.all([
    listAll('mistakes'),
    listAll('docs'),
    listAll('mothers'),
    listAll('plans'),
    listAll('categories'),
    listAll('folders'),
    listAll('papers'),
    listAll('practiceRecords'),
    listAll('bank'),
  ])
  return { version: 3, exportedAt: Date.now(), mistakes, docs, mothers, plans, categories, folders, papers, practiceRecords, bank }
}

export async function importAll(data: BackupData): Promise<void> {
  if (!Array.isArray(data.mistakes) || !Array.isArray(data.docs) || !Array.isArray(data.mothers)) {
    throw new Error('备份文件格式不正确')
  }
  const plans = Array.isArray(data.plans) ? data.plans : []
  const categories = Array.isArray(data.categories) ? data.categories : []
  const folders = Array.isArray(data.folders) ? data.folders : []
  const papers = Array.isArray(data.papers) ? data.papers : []
  const practiceRecords = Array.isArray(data.practiceRecords) ? data.practiceRecords : []
  const bank = Array.isArray(data.bank) ? data.bank : []
  await Promise.all([
    ...data.mistakes.map((item) => put('mistakes', item)),
    ...data.docs.map((item) => put('docs', item)),
    ...data.mothers.map((item) => put('mothers', item)),
    ...plans.map((item) => put('plans', item)),
    ...categories.map((item) => put('categories', item)),
    ...folders.map((item) => put('folders', item)),
    ...papers.map((item) => put('papers', item)),
    ...practiceRecords.map((item) => put('practiceRecords', item)),
    ...bank.map((item) => put('bank', item)),
  ])
}

export async function clearAll(): Promise<void> {
  const stores: StoreName[] = ['mistakes', 'docs', 'mothers', 'plans', 'categories', 'folders', 'papers', 'practiceRecords', 'bank']
  stores.forEach((store) => {
    const ids = stateOf(store).items.map((item) => item.id)
    persistCache(store, [])
    // 删除标记防止后台数据库中尚未清掉的旧数据被重新合并回来
    persistDeleted(store, ids)
  })
  mirror(async (db) => {
    const tx = db.transaction(stores, 'readwrite')
    await Promise.all(stores.map((store) => tx.objectStore(store).clear()))
    await tx.done
  })
}
