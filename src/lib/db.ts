import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { BackupData, KnowledgeDoc, Mistake, MotherQuestion } from '../types'

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
}

export type StoreName = 'mistakes' | 'docs' | 'mothers'

export type EntityMap = {
  mistakes: Mistake
  docs: KnowledgeDoc
  mothers: MotherQuestion
}

const DB_NAME = 'xingce-workbench'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<WorkbenchDB>> | null = null

function getDB(): Promise<IDBPDatabase<WorkbenchDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WorkbenchDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const mistakes = db.createObjectStore('mistakes', { keyPath: 'id' })
        mistakes.createIndex('by-created', 'createdAt')
        mistakes.createIndex('by-type', 'type')

        const docs = db.createObjectStore('docs', { keyPath: 'id' })
        docs.createIndex('by-updated', 'updatedAt')
        docs.createIndex('by-category', 'category')

        const mothers = db.createObjectStore('mothers', { keyPath: 'id' })
        mothers.createIndex('by-created', 'createdAt')
        mothers.createIndex('by-type', 'type')
      },
    }).catch((err) => {
      dbPromise = null
      throw err
    })
  }
  return dbPromise
}

export async function listAll<K extends StoreName>(store: K): Promise<EntityMap[K][]> {
  const db = await getDB()
  return (await db.getAll(store)) as EntityMap[K][]
}

export async function getById<K extends StoreName>(store: K, id: string): Promise<EntityMap[K] | undefined> {
  const db = await getDB()
  return (await db.get(store, id)) as EntityMap[K] | undefined
}

export async function put<K extends StoreName>(store: K, value: EntityMap[K]): Promise<void> {
  const db = await getDB()
  await db.put(store, value as WorkbenchDB[K]['value'])
}

export async function remove<K extends StoreName>(store: K, id: string): Promise<void> {
  const db = await getDB()
  await db.delete(store, id)
}

export async function count(store: StoreName): Promise<number> {
  const db = await getDB()
  return db.count(store)
}

export async function exportAll(): Promise<BackupData> {
  const [mistakes, docs, mothers] = await Promise.all([
    listAll('mistakes'),
    listAll('docs'),
    listAll('mothers'),
  ])
  return { version: 1, exportedAt: Date.now(), mistakes, docs, mothers }
}

export async function importAll(data: BackupData): Promise<void> {
  if (!Array.isArray(data.mistakes) || !Array.isArray(data.docs) || !Array.isArray(data.mothers)) {
    throw new Error('备份文件格式不正确')
  }
  const db = await getDB()
  const tx = db.transaction(['mistakes', 'docs', 'mothers'], 'readwrite')
  await Promise.all([
    ...data.mistakes.map((item) => tx.objectStore('mistakes').put(item)),
    ...data.docs.map((item) => tx.objectStore('docs').put(item)),
    ...data.mothers.map((item) => tx.objectStore('mothers').put(item)),
  ])
  await tx.done
}

export async function clearAll(): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['mistakes', 'docs', 'mothers'], 'readwrite')
  await Promise.all([
    tx.objectStore('mistakes').clear(),
    tx.objectStore('docs').clear(),
    tx.objectStore('mothers').clear(),
  ])
  await tx.done
}
