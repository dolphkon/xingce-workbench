import type { StoreName } from './db'

type SyncHook = (store: StoreName, id: string, payload: Record<string, unknown> | null, updatedAt: number) => void

let hook: SyncHook | null = null
let paused = false

export function setSyncHook(fn: SyncHook | null): void {
  hook = fn
}

/** 应用云端数据时暂停推送，避免把刚拉下来的数据又推回去 */
export function pauseSync(): void { paused = true }
export function resumeSync(): void { paused = false }

export function notifySync(store: StoreName, id: string, payload: Record<string, unknown> | null, updatedAt: number): void {
  if (paused || !hook) return
  hook(store, id, payload, updatedAt)
}
