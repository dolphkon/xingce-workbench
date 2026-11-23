import { CLOUD_AVAILABLE, getCloud, type SyncUser } from './cloud'
import { addSyncHook, pauseSync, resumeSync } from './syncHook'
import {
  applyLocal, buildSnapshot, collectLocal, emitSyncApplied, mergeStores,
  STORES, type LocalEntry,
} from './snapshot'
import type { StoreName } from './db'
import type { BackupData } from '../types'

/** 注册写入钩子：任何本地增改删都会排队推送到云端 */
addSyncHook((store, id, payload, updatedAt) => queuePush(store, id, payload, updatedAt))

export { SYNC_EVENT, emitSyncApplied } from './snapshot'

interface CloudRow {
  store: StoreName
  item_id: string
  payload: Record<string, unknown>
  updated_at: number
  deleted: boolean
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
  const cloudPromise = getCloud()
  if (!cloudPromise) return null
  const cloud = await cloudPromise

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
  const cloudPromise = getCloud()
  if (!cloudPromise) return '当前域名不支持云登录'
  const cloud = await cloudPromise
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
  const cloudPromise = getCloud()
  if (!cloudPromise) return
  const cloud = await cloudPromise
  await cloud.auth.signOut()
}

/**
 * 双向同步（WorkBuddy 云）：
 * 1. 拉取云端全部行  2. 与本地按 updatedAt 合并  3. 上传较新项  4. 通知界面刷新
 */
export async function syncNow(): Promise<{ ok: boolean; message: string; pushed: number; pulled: number }> {
  if (!CLOUD_AVAILABLE) return { ok: false, message: '当前域名不支持云同步', pushed: 0, pulled: 0 }
  const cloudPromise = getCloud()
  if (!cloudPromise) return { ok: false, message: '云同步初始化失败', pushed: 0, pulled: 0 }
  const cloud = await cloudPromise
  const { data: session, error: sessionError } = await cloud.auth.getSession()
  if (sessionError || !session) return { ok: false, message: '请先登录', pushed: 0, pulled: 0 }

  try {
    const fetchResult = await cloud.database.from('workbench_items').select('store, item_id, payload, updated_at, deleted')
    if (fetchResult.error) throw fetchResult.error
    const rows = (fetchResult.data ?? []) as CloudRow[]
    const remote = new Map<StoreName, Map<string, LocalEntry>>()
    rows.forEach((row) => {
      if (!STORES.includes(row.store) || !row.item_id) return
      if (!remote.has(row.store)) remote.set(row.store, new Map())
      remote.get(row.store)!.set(row.item_id, {
        payload: row.deleted ? {} : (row.payload as Record<string, unknown>),
        updatedAt: Number(row.updated_at ?? 0),
      })
    })

    const local = await collectLocal()
    const { pushes, applies, pulled } = mergeStores(local, remote)

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
      const chunk = pushes.slice(i, i + chunkSize).map((item) => ({
        store: item.store,
        item_id: item.item_id,
        payload: item.payload,
        updated_at: item.updatedAt,
        deleted: item.deleted,
      }))
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

/** 单条数据写入后的即时上云推送（失败静默，定时同步会兜底） */
let pushTimer: number | null = null
const pendingPushes = new Map<string, { store: string; id: string; payload: Record<string, unknown>; updatedAt: number; deleted: boolean }>()

export function queuePush(store: string, id: string, payload: Record<string, unknown> | null, updatedAt: number): void {
  if (!CLOUD_AVAILABLE) return
  pendingPushes.set(`${store}:${id}`, { store, id, payload: payload ?? {}, updatedAt, deleted: !payload })
  if (pushTimer != null) window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => void flushPushes(), 700)
}

async function flushPushes(): Promise<void> {
  pushTimer = null
  if (pendingPushes.size === 0) return
  const cloudPromise = getCloud()
  if (!cloudPromise) return
  const cloud = await cloudPromise
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
  const snap = await buildSnapshot()
  return {
    version: 2,
    exportedAt: snap.exportedAt,
    mistakes: Object.values(snap.stores.mistakes ?? {}).map((e) => e.payload) as unknown as BackupData['mistakes'],
    docs: Object.values(snap.stores.docs ?? {}).map((e) => e.payload) as unknown as BackupData['docs'],
    mothers: Object.values(snap.stores.mothers ?? {}).map((e) => e.payload) as unknown as BackupData['mothers'],
    plans: Object.values(snap.stores.plans ?? {}).map((e) => e.payload) as unknown as BackupData['plans'],
    categories: Object.values(snap.stores.categories ?? {}).map((e) => e.payload) as unknown as BackupData['categories'],
  }
}
