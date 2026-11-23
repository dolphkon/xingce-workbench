import {
  listAll, put as dbPut, remove as dbRemove, readCachedAll,
  type EntityMap, type StoreName,
} from './db'
import {
  cachePlan, deletePlan, loadPlans, normalizePlan, readTombstones as plansTombstones,
} from './plans'
import type { BackupData, StudyPlan } from '../types'

export const STORES: StoreName[] = ['mistakes', 'docs', 'mothers', 'plans']

/** 同步事件：数据层应用了远端数据后通知界面刷新 */
export const SYNC_EVENT = 'xingce-sync-applied'
export function emitSyncApplied(): void {
  window.dispatchEvent(new Event(SYNC_EVENT))
}

export function readDeleted(store: StoreName): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(`xingce-deleted-v1-${store}`) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export interface LocalEntry { payload: Record<string, unknown>; updatedAt: number }

/** 从各 store 的本地缓存 + 学习计划的独立存储收集条目 */
export async function collectLocal(): Promise<Map<StoreName, Map<string, LocalEntry>>> {
  const result = new Map<StoreName, Map<string, LocalEntry>>()
  const [plans, plansDeleted] = await Promise.all([loadPlans(), Promise.resolve(plansTombstones())])
  const snapshots: Record<StoreName, { items: unknown[]; deleted: Set<string> }> = {
    mistakes: { items: readCachedAll('mistakes'), deleted: readDeleted('mistakes') },
    docs: { items: readCachedAll('docs'), deleted: readDeleted('docs') },
    mothers: { items: readCachedAll('mothers'), deleted: readDeleted('mothers') },
    plans: { items: plans, deleted: new Set(plansDeleted) },
  }
  STORES.forEach((store) => {
    const map = new Map<string, LocalEntry>()
    const { items, deleted } = snapshots[store]
    items.forEach((item) => {
      const payload = item as Record<string, unknown>
      const id = String(payload.id ?? '')
      if (id) map.set(id, { payload, updatedAt: Number(payload.updatedAt ?? 0) })
    })
    deleted.forEach((id) => { map.set(id, { payload: {}, updatedAt: 0 }) })
    result.set(store, map)
  })
  return result
}

export type ApplyEntry = { store: StoreName; item: Record<string, unknown> | null; deleteId: string | null }

/** 把远端数据写入本地：普通 store 用 put/remove，plans 用独立存储 */
export async function applyLocal(applies: ApplyEntry[]): Promise<void> {
  const groups = new Map<StoreName, ApplyEntry[]>()
  applies.forEach((entry) => {
    if (!groups.has(entry.store)) groups.set(entry.store, [])
    groups.get(entry.store)!.push(entry)
  })
  await Promise.all(Array.from(groups.entries()).map(async ([store, entries]) => {
    await Promise.all(entries.map(async (entry) => {
      if (store === 'plans') {
        if (entry.deleteId) await deletePlan(entry.deleteId)
        else if (entry.item) cachePlan(normalizePlan(entry.item as unknown as StudyPlan))
        return
      }
      if (entry.deleteId) await dbRemove(store, entry.deleteId)
      else if (entry.item) await dbPut(store, entry.item as unknown as EntityMap[typeof store])
    }))
  }))
}

/** 通用双向合并：本地 local 与远端 remote 按 updatedAt 取新，删除优先。返回需上传项与需落地项。 */
export interface PushEntry {
  store: StoreName
  item_id: string
  payload: Record<string, unknown>
  updatedAt: number
  deleted: boolean
}

export function mergeStores(
  local: Map<StoreName, Map<string, LocalEntry>>,
  remote: Map<StoreName, Map<string, LocalEntry>>,
): { pushes: PushEntry[]; applies: ApplyEntry[]; pulled: number } {
  const pushes: PushEntry[] = []
  const applies: ApplyEntry[] = []
  let pulled = 0

  STORES.forEach((store) => {
    const localMap = local.get(store)!
    const remoteMap = remote.get(store) ?? new Map()
    const ids = new Set([...localMap.keys(), ...remoteMap.keys()])
    ids.forEach((id) => {
      const localEntry = localMap.get(id)
      const remoteEntry = remoteMap.get(id)
      const localDeleted = Boolean(localEntry && Object.keys(localEntry.payload).length === 0)
      const localTime = localEntry?.updatedAt ?? 0
      const remoteTime = remoteEntry?.updatedAt ?? 0
      const remoteDeleted = Boolean(remoteEntry && Object.keys(remoteEntry.payload).length === 0)

      if (remoteDeleted) {
        if (localEntry && !localDeleted && localTime > remoteTime) {
          pushes.push({ store, item_id: id, payload: localEntry.payload, updatedAt: localTime, deleted: false })
        } else if (localEntry && !localDeleted) {
          applies.push({ store, item: null, deleteId: id })
          pulled += 1
        }
        return
      }
      if (localDeleted) {
        if (!remoteEntry || !remoteDeleted) {
          pushes.push({ store, item_id: id, payload: {}, updatedAt: Date.now(), deleted: true })
        }
        return
      }
      if (!localEntry && remoteEntry) {
        applies.push({ store, item: remoteEntry.payload, deleteId: null })
        pulled += 1
        return
      }
      if (localEntry && !remoteEntry) {
        pushes.push({ store, item_id: id, payload: localEntry.payload, updatedAt: localTime, deleted: false })
        return
      }
      if (localEntry && remoteEntry && localTime > remoteTime) {
        pushes.push({ store, item_id: id, payload: localEntry.payload, updatedAt: localTime, deleted: false })
      } else if (localEntry && remoteEntry && remoteTime > localTime) {
        applies.push({ store, item: remoteEntry.payload, deleteId: null })
        pulled += 1
      }
    })
  })
  return { pushes, applies, pulled }
}

export interface Snapshot {
  version: 1
  exportedAt: number
  stores: Record<string, Record<string, LocalEntry>>
  deleted: Record<string, string[]>
}

export async function buildSnapshot(): Promise<Snapshot> {
  const data: BackupData = {
    version: 2,
    exportedAt: Date.now(),
    mistakes: await listAll('mistakes'),
    docs: await listAll('docs'),
    mothers: await listAll('mothers'),
    plans: await loadPlans(),
  }
  const stores: Record<string, Record<string, LocalEntry>> = {}
  STORES.forEach((store) => {
    const map: Record<string, LocalEntry> = {}
    const items = (data[store] ?? []) as unknown as Array<Record<string, unknown>>
    items.forEach((item) => {
      const id = String(item.id ?? '')
      if (id) map[id] = { payload: item, updatedAt: Number(item.updatedAt ?? 0) }
    })
    stores[store] = map
  })
  const deleted: Record<string, string[]> = {}
  STORES.forEach((store) => { deleted[store] = Array.from(readDeleted(store)) })
  deleted.plans = Array.from(new Set([...deleted.plans, ...plansTombstones()]))
  return { version: 1, exportedAt: Date.now(), stores, deleted }
}
