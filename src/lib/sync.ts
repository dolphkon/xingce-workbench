import { CLOUD_AVAILABLE, cloud, type SyncUser } from './cloud'
import {
  listAll, put as dbPut, remove as dbRemove, readCachedAll,
  type EntityMap, type StoreName,
} from './db'
import {
  cachePlan, deletePlan, loadPlans, normalizePlan, readTombstones as plansTombstones,
} from './plans'
import { pauseSync, resumeSync, setSyncHook } from './syncHook'
import type { BackupData } from '../types'

/** 注册写入钩子：任何本地增改删都会排队推送到云端 */
setSyncHook((store, id, payload, updatedAt) => queuePush(store, id, payload, updatedAt))

/** 云端表的一行（owner_id 由数据库按登录身份自动填充，前端不传） */
interface CloudRow {
  store: StoreName
  item_id: string
  payload: Record<string, unknown>
  updated_at: number
  deleted: boolean
}

const STORES: StoreName[] = ['mistakes', 'docs', 'mothers', 'plans']

/** 同步事件：数据层应用了云端数据后通知界面刷新 */
export const SYNC_EVENT = 'xingce-sync-applied'
export function emitSyncApplied() {
  window.dispatchEvent(new Event(SYNC_EVENT))
}

function currentUser(session: { user: { id: string; name?: string } } | null | undefined): SyncUser | null {
  if (!session?.user?.id) return null
  return { id: session.user.id, name: session.user.name || '用户' }
}

/** 启动页处理微信 OAuth 回调；普通访问时仅恢复会话。必须在任何渲染前调用。 */
export async function restoreAuth(): Promise<SyncUser | null> {
  const url = new URL(window.location.href)
  const hasCallback = url.searchParams.has('code') || url.searchParams.has('error')
  if (!CLOUD_AVAILABLE) return null

  if (hasCallback) {
    const provider = url.searchParams.get('provider')
    let session: Awaited<ReturnType<typeof cloud.auth.handleWechatWebCallback>>['data'] = null
    if (provider === 'wechat' || !provider) {
      const result = await cloud.auth.handleWechatWebCallback()
      session = result.data
      if (result.error) {
        // 回调失败：清掉参数，避免刷新时重放已消费的 code
        for (const key of ['code', 'state', 'provider']) url.searchParams.delete(key)
        history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
        return null
      }
    }
    for (const key of ['code', 'state', 'provider']) url.searchParams.delete(key)
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    if (session) return currentUser(session)
  }

  const result = await cloud.auth.getSession()
  return currentUser(result.data)
}

/** 发起微信扫码登录：同标签页跳转，回调落在站点根路径 */
export async function signInWithWechat(): Promise<string | null> {
  // OAuth 回调必须落在站点根：hash 路由会让 code/state 参数落进片段而读不到，
  // 因此这里只保留业务 query（如 sharecode），去掉 path 子级与 hash。
  const back = new URL(window.location.origin + '/')
  const current = new URL(window.location.href)
  current.searchParams.forEach((value, key) => {
    if (!['code', 'state', 'provider'].includes(key)) back.searchParams.set(key, value)
  })
  const { data, error } = await cloud.auth.signInWithOAuth({
    provider: 'wechat',
    redirectTo: back.toString(),
  })
  if (error) return error.message
  if (!data?.url) return '登录跳转失败，请重试'
  window.location.assign(data.url)
  return null
}

export async function signOut(): Promise<void> {
  await cloud.auth.signOut()
}

/** 从各 store 的本地缓存 + 学习计划的独立存储收集待同步条目 */
async function collectLocal(): Promise<Map<string, Map<string, { payload: Record<string, unknown>; updatedAt: number }>>> {
  const result = new Map<string, Map<string, { payload: Record<string, unknown>; updatedAt: number }>>()
  const [plans, plansDeleted] = await Promise.all([loadPlans(), Promise.resolve(plansTombstones())])
  const snapshots: Record<StoreName, { items: unknown[]; deleted: Set<string> }> = {
    mistakes: { items: readCachedAll('mistakes'), deleted: readDeleted('mistakes') },
    docs: { items: readCachedAll('docs'), deleted: readDeleted('docs') },
    mothers: { items: readCachedAll('mothers'), deleted: readDeleted('mothers') },
    plans: { items: plans, deleted: new Set(plansDeleted) },
  }
  STORES.forEach((store) => {
    const map = new Map<string, { payload: Record<string, unknown>; updatedAt: number }>()
    const { items, deleted } = snapshots[store]
    items.forEach((item) => {
      const payload = item as Record<string, unknown>
      const id = String(payload.id ?? '')
      if (id) map.set(id, { payload, updatedAt: Number(payload.updatedAt ?? 0) })
    })
    deleted.forEach((id) => {
      map.set(id, { payload: {}, updatedAt: 0 })
    })
    result.set(store, map)
  })
  return result
}

function readDeleted(store: StoreName): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(`xingce-deleted-v1-${store}`) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * 双向同步：
 * 1. 先拉取云端全部行
 * 2. 与本地按 updatedAt 合并（新的胜出）；云端删除标记同步到本地删除标记
 * 3. 把本地较新的条目 upsert 到云端
 * 4. 把合并结果写回本地缓存并通知界面刷新
 */
export async function syncNow(): Promise<{ ok: boolean; message: string; pushed: number; pulled: number }> {
  if (!CLOUD_AVAILABLE) return { ok: false, message: '当前域名不支持云同步', pushed: 0, pulled: 0 }
  const { data: session, error: sessionError } = await cloud.auth.getSession()
  if (sessionError || !session) return { ok: false, message: '请先登录', pushed: 0, pulled: 0 }

  try {
    const fetchResult = await cloud.database.from('workbench_items').select('store, item_id, payload, updated_at, deleted')
    if (fetchResult.error) throw fetchResult.error
    const rows = (fetchResult.data ?? []) as CloudRow[]
    const remote = new Map<string, Map<string, CloudRow>>()
    rows.forEach((row) => {
      if (!STORES.includes(row.store) || !row.item_id) return
      if (!remote.has(row.store)) remote.set(row.store, new Map())
      remote.get(row.store)!.set(row.item_id, row)
    })

    const local = await collectLocal()
    const pushes: Array<{ store: StoreName; item_id: string; payload: Record<string, unknown>; updated_at: number; deleted: boolean }> = []
    const applies: Array<{ store: StoreName; item: Record<string, unknown> | null; deleteId: string | null }> = []
    let pulled = 0

    STORES.forEach((store) => {
      const localMap = local.get(store)!
      const remoteMap = remote.get(store) ?? new Map()
      const ids = new Set([...localMap.keys(), ...remoteMap.keys()])

      ids.forEach((id) => {
        const localEntry = localMap.get(id)
        const remoteRow = remoteMap.get(id)
        const localDeleted = Boolean(localEntry && Object.keys(localEntry.payload).length === 0)
        const localTime = localEntry?.updatedAt ?? 0
        const remoteTime = Number(remoteRow?.updated_at ?? 0)
        const remoteDeleted = Boolean(remoteRow?.deleted)

        if (remoteDeleted) {
          if (localEntry && !localDeleted && localTime > remoteTime) {
            // 本地有更新版本，恢复云端记录
            pushes.push({ store, item_id: id, payload: localEntry.payload, updated_at: localTime, deleted: false })
          } else if (localEntry && !localDeleted) {
            // 云端已删除且更新：本地同步删除
            applies.push({ store, item: null, deleteId: id })
            pulled += 1
          }
          return
        }

        if (localDeleted) {
          // 本地删除优先：始终向云端同步删除标记，避免已删条目被实时推送或旧数据复活
          if (!remoteRow || !remoteDeleted) {
            pushes.push({ store, item_id: id, payload: {}, updated_at: Date.now(), deleted: true })
          }
          return
        }

        if (!localEntry && remoteRow) {
          applies.push({ store, item: remoteRow.payload, deleteId: null })
          pulled += 1
          return
        }
        if (localEntry && !remoteRow) {
          pushes.push({ store, item_id: id, payload: localEntry.payload, updated_at: localTime, deleted: false })
          return
        }
        if (localEntry && remoteRow && localTime > remoteTime) {
          pushes.push({ store, item_id: id, payload: localEntry.payload, updated_at: localTime, deleted: false })
        } else if (localEntry && remoteRow && remoteTime > localTime) {
          applies.push({ store, item: remoteRow.payload, deleteId: null })
          pulled += 1
        }
      })
    })

    // 先应用云端较新的数据到本地（暂停推送，避免把刚拉下来的数据又推回去）
    if (applies.length) {
      pauseSync()
      try {
        await applyLocal(applies)
      } finally {
        resumeSync()
      }
    }

    // 再推送本地较新的数据到云端（带身份隔离，前端不传 owner_id）
    const chunkSize = 40
    for (let i = 0; i < pushes.length; i += chunkSize) {
      const chunk = pushes.slice(i, i + chunkSize)
      const upsert = await cloud.database.from('workbench_items').upsert(chunk as never)
      if (upsert.error) throw upsert.error
    }

    if (applies.length) emitSyncApplied()
    return { ok: true, message: `同步完成：上传 ${pushes.length} 项，下载 ${pulled} 项`, pushed: pushes.length, pulled }
  } catch (err) {
    const message = err instanceof Error ? err.message : '同步失败，请稍后重试'
    return { ok: false, message, pushed: 0, pulled: 0 }
  }
}

/** 把云端数据写入本地：普通 store 用 put/remove，plans 用独立存储 */
async function applyLocal(applies: Array<{ store: StoreName; item: Record<string, unknown> | null; deleteId: string | null }>): Promise<void> {
  const groups = new Map<StoreName, typeof applies>()
  applies.forEach((entry) => {
    if (!groups.has(entry.store)) groups.set(entry.store, [])
    groups.get(entry.store)!.push(entry)
  })
  await Promise.all(Array.from(groups.entries()).map(async ([store, entries]) => {
    await Promise.all(entries.map(async (entry) => {
      if (store === 'plans') {
        if (entry.deleteId) {
          await deletePlan(entry.deleteId)
        } else if (entry.item) {
          cachePlan(normalizePlan(entry.item as unknown as import('../types').StudyPlan))
        }
        return
      }
      if (entry.deleteId) {
        await dbRemove(store, entry.deleteId)
      } else if (entry.item) {
        await dbPut(store, entry.item as unknown as EntityMap[typeof store])
      }
    }))
  }))
}

/** 单条数据写入后的即时上云推送（失败静默，定时同步会兜底） */
let pushTimer: number | null = null
const pendingPushes = new Map<string, { store: StoreName; id: string; payload: Record<string, unknown>; updatedAt: number; deleted: boolean }>()

export function queuePush<K extends StoreName>(store: K, id: string, payload: Record<string, unknown> | null, updatedAt: number): void {
  if (!CLOUD_AVAILABLE) return
  pendingPushes.set(`${store}:${id}`, { store, id, payload: payload ?? {}, updatedAt, deleted: !payload })
  if (pushTimer != null) window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => void flushPushes(), 700)
}

async function flushPushes(): Promise<void> {
  pushTimer = null
  if (pendingPushes.size === 0) return
  const { data: session } = await cloud.auth.getSession()
  if (!session) return
  const items = Array.from(pendingPushes.values())
  pendingPushes.clear()
  try {
    await cloud.database.from('workbench_items').upsert(items.map((item) => ({
      store: item.store,
      item_id: item.id,
      payload: item.payload,
      updated_at: item.updatedAt,
      deleted: item.deleted,
    })) as never)
  } catch {
    // 网络失败不丢数据：放回队列，等待下次触发
    items.forEach((item) => pendingPushes.set(`${item.store}:${item.id}`, item))
  }
}

/** 备份导出时附带云端同步标记，导入时把数据并入本地后统一上云 */
export async function exportWithCloud(): Promise<BackupData> {
  const data: BackupData = {
    version: 2,
    exportedAt: Date.now(),
    mistakes: await listAll('mistakes'),
    docs: await listAll('docs'),
    mothers: await listAll('mothers'),
    plans: await loadPlans(),
  }
  return data
}
