import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { BackupData, KnowledgeDoc, Mistake, MotherQuestion, StudyPlan } from '../types'

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
}

export type StoreName = 'mistakes' | 'docs' | 'mothers' | 'plans'

export type EntityMap = {
  mistakes: Mistake
  docs: KnowledgeDoc
  mothers: MotherQuestion
  plans: StudyPlan
}

const DB_NAME = 'xingce-workbench'
const DB_VERSION = 2
const CACHE_PREFIX = 'xingce-cache-v1-'
const DELETED_PREFIX = 'xingce-deleted-v1-'
const DB_TIMEOUT = 1500

let dbPromise: Promise<IDBPDatabase<WorkbenchDB>> | null = null

function getDB(): Promise<IDBPDatabase<WorkbenchDB>> {
  if (!dbPromise) {
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
      },
    }).catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

/**
 * IndexedDB 在部分浏览器环境可能被阻塞或极慢，导致页面永远停在「加载中」。
 * 所有数据库操作都带超时保护，并以 localStorage 镜像作为回退：
 * 写操作先同步落缓存，读操作在超时后返回缓存数据。
 */
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

function readCache<K extends StoreName>(store: K): EntityMap[K][] {
  try {
    const raw = window.localStorage.getItem(`${CACHE_PREFIX}${store}`)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as EntityMap[K][]) : []
  } catch {
    return []
  }
}

function writeCache<K extends StoreName>(store: K, items: EntityMap[K][]): void {
  try {
    window.localStorage.setItem(`${CACHE_PREFIX}${store}`, JSON.stringify(items))
  } catch {
    // 浏览器禁用本地存储时忽略，仍可尝试数据库
  }
}

function readDeleted(store: StoreName): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(`${DELETED_PREFIX}${store}`) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeDeleted(store: StoreName, ids: string[]): void {
  try {
    window.localStorage.setItem(`${DELETED_PREFIX}${store}`, JSON.stringify(Array.from(new Set(ids))))
  } catch {
    // 忽略
  }
}

export async function listAll<K extends StoreName>(store: K): Promise<EntityMap[K][]> {
  const cached = readCache(store)
  const deleted = new Set(readDeleted(store))
  const remote = await withFallback(
    getDB().then((db) => db.getAll(store) as Promise<EntityMap[K][]>),
    DB_TIMEOUT,
    [] as EntityMap[K][],
  )
  const map = new Map<string, EntityMap[K]>()
  const merge = (item: EntityMap[K]) => {
    if (deleted.has(item.id)) return
    const existing = map.get(item.id)
    if (!existing || (item.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) map.set(item.id, item)
  }
  remote.forEach(merge)
  cached.forEach(merge)
  const result = Array.from(map.values())
  writeCache(store, result)
  return result
}

export async function getById<K extends StoreName>(store: K, id: string): Promise<EntityMap[K] | undefined> {
  const cached = readCache(store).find((item) => item.id === id)
  const remote = await withFallback(
    getDB().then((db) => db.get(store, id) as Promise<EntityMap[K] | undefined>),
    DB_TIMEOUT,
    undefined as EntityMap[K] | undefined,
  )
  if (readDeleted(store).includes(id)) return undefined
  if (cached && (!remote || (cached.updatedAt ?? 0) >= (remote.updatedAt ?? 0))) return cached
  return remote
}

export async function put<K extends StoreName>(store: K, value: EntityMap[K]): Promise<void> {
  // 立即同步缓存，避免保存按钮在数据库阻塞时无响应
  writeCache(store, [...readCache(store).filter((item) => item.id !== value.id), value])
  writeDeleted(store, readDeleted(store).filter((id) => id !== value.id))
  await withFallback(
    getDB().then((db) => db.put(store, value as WorkbenchDB[K]['value'])),
    DB_TIMEOUT,
    undefined,
  )
}

export async function remove<K extends StoreName>(store: K, id: string): Promise<void> {
  writeDeleted(store, [...readDeleted(store), id])
  writeCache(store, readCache(store).filter((item) => item.id !== id))
  await withFallback(
    getDB().then((db) => db.delete(store, id)),
    DB_TIMEOUT,
    undefined,
  )
}

export async function count(store: StoreName): Promise<number> {
  return (await listAll(store)).length
}

export async function exportAll(): Promise<BackupData> {
  const [mistakes, docs, mothers, plans] = await Promise.all([
    listAll('mistakes'),
    listAll('docs'),
    listAll('mothers'),
    listAll('plans'),
  ])
  return { version: 2, exportedAt: Date.now(), mistakes, docs, mothers, plans }
}

export async function importAll(data: BackupData): Promise<void> {
  if (!Array.isArray(data.mistakes) || !Array.isArray(data.docs) || !Array.isArray(data.mothers)) {
    throw new Error('备份文件格式不正确')
  }
  const plans = Array.isArray(data.plans) ? data.plans : []
  await Promise.all([
    ...data.mistakes.map((item) => put('mistakes', item)),
    ...data.docs.map((item) => put('docs', item)),
    ...data.mothers.map((item) => put('mothers', item)),
    ...plans.map((item) => put('plans', item)),
  ])
}

export async function clearAll(): Promise<void> {
  const stores: StoreName[] = ['mistakes', 'docs', 'mothers', 'plans']
  stores.forEach((store) => {
    writeCache(store, [])
    writeDeleted(store, [])
  })
  await withFallback(
    getDB().then(async (db) => {
      const tx = db.transaction(stores, 'readwrite')
      await Promise.all(stores.map((store) => tx.objectStore(store).clear()))
      await tx.done
    }),
    DB_TIMEOUT,
    undefined,
  )
}
