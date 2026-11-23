import type { StoreName } from './db'

type SyncHook = (store: StoreName, id: string, payload: Record<string, unknown> | null, updatedAt: number) => void

const hooks = new Set<SyncHook>()
let paused = false

/** 注册一个写入钩子，返回取消注册函数。多个同步后端可同时监听同一份本地写入。 */
export function addSyncHook(fn: SyncHook): () => void {
  hooks.add(fn)
  return () => { hooks.delete(fn) }
}

/** 兼容旧调用：清空后设置唯一钩子 */
export function setSyncHook(fn: SyncHook | null): void {
  hooks.clear()
  if (fn) hooks.add(fn)
}

/** 应用远端数据时暂停推送，避免把刚拉下来的数据又推回去 */
export function pauseSync(): void { paused = true }
export function resumeSync(): void { paused = false }

export function notifySync(store: StoreName, id: string, payload: Record<string, unknown> | null, updatedAt: number): void {
  if (paused) return
  hooks.forEach((hook) => {
    try {
      hook(store, id, payload, updatedAt)
    } catch {
      // 单个后端失败不应影响其它后端或正常写入
    }
  })
}
