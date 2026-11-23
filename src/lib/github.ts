import { addSyncHook, pauseSync, resumeSync } from './syncHook'
import {
  applyLocal, buildSnapshot, collectLocal, emitSyncApplied, mergeStores,
  STORES, type LocalEntry, type Snapshot,
} from './snapshot'
import type { StoreName } from './db'

/**
 * GitHub 数据存储：把工作台数据快照存进 GitHub 仓库的一个 JSON 文件，
 * 通过 GitHub REST API 读写，实现真正的跨设备访问（包括 GitHub Pages 站点）。
 *
 * 凭证（Fine-grained PAT，仅勾选 Contents 读写）由用户在界面输入，保存在本机
 * localStorage，不会随代码发布。所有请求直连 api.github.com。
 */

const CONFIG_KEY = 'xingce-github-config-v1'
const DEFAULT_PATH = 'data/workbench-snapshot.json'
const API_BASE = 'https://api.github.com'

export interface GitHubConfig {
  owner: string
  repo: string
  branch: string
  path: string
  token: string
}

export function readGitHubConfig(): GitHubConfig | null {
  try {
    const raw = window.localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<GitHubConfig>
    if (!parsed.owner || !parsed.repo || !parsed.token) return null
    return {
      owner: parsed.owner,
      repo: parsed.repo,
      branch: parsed.branch || 'main',
      path: parsed.path || DEFAULT_PATH,
      token: parsed.token,
    }
  } catch {
    return null
  }
}

export function writeGitHubConfig(config: GitHubConfig): void {
  window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
}

export function clearGitHubConfig(): void {
  window.localStorage.removeItem(CONFIG_KEY)
}

export function isGitHubConfigured(): boolean {
  return readGitHubConfig() !== null
}

/** 从 GitHub 错误信息中提取可读提示 */
function friendlyError(status: number, body: unknown): string {
  const message = (body as { message?: string })?.message
  if (status === 401) return '令牌无效或已过期，请重新配置'
  if (status === 403) return '令牌权限不足或触发速率限制，请检查令牌的 Contents 读写权限'
  if (status === 404) return '仓库或分支不存在，请检查仓库名与分支'
  return message || `GitHub 请求失败（${status}）`
}

async function api(config: GitHubConfig, path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  let data: unknown = null
  const text = await response.text()
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  return { ok: response.ok, status: response.status, data }
}

/** UTF-8 安全的字符串 <-> base64（避免中文乱码与栈溢出） */
function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fromBase64(base64: string): string {
  const clean = base64.replace(/\s/g, '')
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

interface ContentRef {
  sha: string
  blobSha: string | null
  content: Snapshot | null
}

/** 读取仓库中的数据文件；不存在时返回 null（首次同步会创建） */
async function readSnapshotFile(config: GitHubConfig): Promise<{ ok: boolean; message: string; ref: ContentRef | null }> {
  const encodedPath = config.path.split('/').map(encodeURIComponent).join('/')
  const result = await api(config, `/repos/${config.owner}/${config.repo}/contents/${encodedPath}?ref=${encodeURIComponent(config.branch)}`)
  if (result.status === 404) {
    return { ok: true, message: '', ref: { sha: '', blobSha: null, content: null } }
  }
  if (!result.ok) {
    return { ok: false, message: friendlyError(result.status, result.data), ref: null }
  }
  const body = result.data as { sha?: string; content?: string; encoding?: string }
  let raw = body.content
  // GitHub Contents API 对超过 1MB 的文件返回 content 为空，需改用 Git Blob API 读取完整内容
  if (!raw && body.sha) {
    const blobResult = await api(config, `/repos/${config.owner}/${config.repo}/git/blobs/${body.sha}`)
    if (!blobResult.ok) return { ok: false, message: friendlyError(blobResult.status, blobResult.data), ref: null }
    raw = (blobResult.data as { content?: string })?.content ?? undefined
  }
  try {
    const parsed = raw ? (JSON.parse(fromBase64(raw)) as Snapshot) : null
    return { ok: true, message: '', ref: { sha: body.sha ?? '', blobSha: body.sha ?? null, content: parsed } }
  } catch {
    return { ok: false, message: '云端数据文件解析失败', ref: null }
  }
}

function snapshotToRemote(snapshot: Snapshot | null): Map<StoreName, Map<string, LocalEntry>> {
  const remote = new Map<StoreName, Map<string, LocalEntry>>()
  STORES.forEach((store) => {
    const map = new Map<string, LocalEntry>()
    const entries = snapshot?.stores?.[store] ?? {}
    Object.entries(entries).forEach(([id, entry]) => {
      map.set(id, { payload: entry.payload, updatedAt: Number(entry.updatedAt ?? 0) })
    })
    // 删除标记用快照生成时间作为时间戳，保证晚于条目创建时间，从而在合并时胜过本地旧副本
    const deleted = snapshot?.deleted?.[store] ?? []
    const deletedAt = Number(snapshot?.exportedAt ?? 0)
    deleted.forEach((id) => { map.set(id, { payload: {}, updatedAt: deletedAt }) })
    remote.set(store, map)
  })
  return remote
}

/** 把本地改动叠加到云端快照，生成待提交的新快照 */
function applyPushesToSnapshot(snapshot: Snapshot, pushes: Array<{ store: string; item_id: string; payload: Record<string, unknown>; updatedAt: number; deleted: boolean }>): Snapshot {
  const next: Snapshot = {
    version: 1,
    exportedAt: Date.now(),
    stores: { ...(snapshot.stores ?? {}) },
    deleted: { ...(snapshot.deleted ?? {}) },
  }
  STORES.forEach((store) => { next.stores[store] = { ...(next.stores[store] ?? {}) }; next.deleted[store] = [...(next.deleted[store] ?? [])] })
  pushes.forEach((push) => {
    if (!STORES.includes(push.store as StoreName)) return
    if (push.deleted) {
      delete next.stores[push.store][push.item_id]
      if (!next.deleted[push.store].includes(push.item_id)) next.deleted[push.store].push(push.item_id)
    } else {
      next.stores[push.store][push.item_id] = { payload: push.payload, updatedAt: push.updatedAt }
      next.deleted[push.store] = next.deleted[push.store].filter((id) => id !== push.item_id)
    }
  })
  return next
}

/** 提交快照：通过 Contents API 创建或更新文件（单文件 commit） */
async function writeSnapshotFile(config: GitHubConfig, snapshot: Snapshot, currentSha: string | null): Promise<{ ok: boolean; message: string }> {
  const encodedPath = config.path.split('/').map(encodeURIComponent).join('/')
  const body: Record<string, unknown> = {
    message: `chore: sync xingce workbench data ${new Date().toISOString()}`,
    content: toBase64(JSON.stringify(snapshot)),
    branch: config.branch,
  }
  if (currentSha) body.sha = currentSha
  const result = await api(config, `/repos/${config.owner}/${config.repo}/contents/${encodedPath}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  if (!result.ok) return { ok: false, message: friendlyError(result.status, result.data) }
  return { ok: true, message: '' }
}

/** 校验配置：读取仓库信息，确认可访问 */
export async function testGitHubConfig(config: GitHubConfig): Promise<{ ok: boolean; message: string; isPrivate?: boolean }> {
  const result = await api(config, `/repos/${config.owner}/${config.repo}`)
  if (!result.ok) return { ok: false, message: friendlyError(result.status, result.data) }
  const isPrivate = Boolean((result.data as { private?: boolean })?.private)
  const perms = (result.data as { permissions?: { contents?: string } })?.permissions
  if (perms && perms.contents !== 'write' && perms.contents !== 'admin') {
    return { ok: false, message: '令牌缺少 Contents 写入权限，请重新生成 Fine-grained token 并勾选 Contents: read and write' }
  }
  return { ok: true, message: isPrivate ? '连接成功（私有仓库，数据不会公开）' : '连接成功', isPrivate }
}

/** 确保数据分支存在：不存在则从默认分支创建，避免数据写入触发 Pages 重新构建 */
export async function ensureBranch(config: GitHubConfig): Promise<{ ok: boolean; message: string }> {
  const exists = await api(config, `/repos/${config.owner}/${config.repo}/branches/${encodeURIComponent(config.branch)}`)
  if (exists.ok) return { ok: true, message: '' }
  const repoInfo = await api(config, `/repos/${config.owner}/${config.repo}`)
  if (!repoInfo.ok) return { ok: false, message: friendlyError(repoInfo.status, repoInfo.data) }
  const defaultBranch = (repoInfo.data as { default_branch?: string })?.default_branch || 'main'
  const head = await api(config, `/repos/${config.owner}/${config.repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`)
  if (!head.ok) return { ok: false, message: friendlyError(head.status, head.data) }
  const sha = (head.data as { object?: { sha?: string } })?.object?.sha
  if (!sha) return { ok: false, message: '无法读取默认分支版本' }
  const created = await api(config, `/repos/${config.owner}/${config.repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${config.branch}`, sha }),
  })
  if (!created.ok) return { ok: false, message: friendlyError(created.status, created.data) }
  return { ok: true, message: '' }
}

export interface SyncResult { ok: boolean; message: string; pushed: number; pulled: number }

/** 与 GitHub 仓库双向同步 */
export async function githubSyncNow(config: GitHubConfig = readGitHubConfig()!): Promise<SyncResult> {
  if (!config) return { ok: false, message: '请先配置 GitHub', pushed: 0, pulled: 0 }
  try {
    const fetched = await readSnapshotFile(config)
    if (!fetched.ok || !fetched.ref) return { ok: false, message: fetched.message, pushed: 0, pulled: 0 }

    const local = await collectLocal()
    const remote = snapshotToRemote(fetched.ref.content)
    const { pushes, applies, pulled } = mergeStores(local, remote)

    if (applies.length) {
      pauseSync()
      try { await applyLocal(applies) } finally { resumeSync() }
    }

    const snapshot = fetched.ref.content ?? { version: 1, exportedAt: 0, stores: {}, deleted: {} }
    const nextSnapshot = pushes.length ? applyPushesToSnapshot(snapshot, pushes) : snapshot
    if (pushes.length) {
      const written = await writeSnapshotFile(config, nextSnapshot, fetched.ref.sha || null)
      if (!written.ok) return { ok: false, message: written.message, pushed: 0, pulled: 0 }
    }

    if (applies.length) emitSyncApplied()
    return {
      ok: true,
      message: `同步完成：上传 ${pushes.length} 项，下载 ${pulled} 项`,
      pushed: pushes.length,
      pulled,
    }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '同步失败，请稍后重试', pushed: 0, pulled: 0 }
  }
}

/** 强制把本机全部数据覆盖上传到 GitHub（用于首次配置后的初始化） */
export async function githubPushAll(config: GitHubConfig = readGitHubConfig()!): Promise<SyncResult> {
  if (!config) return { ok: false, message: '请先配置 GitHub', pushed: 0, pulled: 0 }
  try {
    const snapshot = await buildSnapshot()
    const fetched = await readSnapshotFile(config)
    if (!fetched.ok || !fetched.ref) return { ok: false, message: fetched.message, pushed: 0, pulled: 0 }
    const written = await writeSnapshotFile(config, snapshot, fetched.ref.sha || null)
    if (!written.ok) return { ok: false, message: written.message, pushed: 0, pulled: 0 }
    return { ok: true, message: '已上传本机全部数据', pushed: STORES.reduce((n, s) => n + Object.keys(snapshot.stores[s] ?? {}).length, 0), pulled: 0 }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '上传失败', pushed: 0, pulled: 0 }
  }
}

/** 从 GitHub 数据文件覆盖恢复本机（谨慎操作，界面需二次确认） */
export async function githubPullAll(config: GitHubConfig = readGitHubConfig()!): Promise<SyncResult> {
  if (!config) return { ok: false, message: '请先配置 GitHub', pushed: 0, pulled: 0 }
  try {
    const fetched = await readSnapshotFile(config)
    if (!fetched.ok || !fetched.ref) return { ok: false, message: fetched.message, pushed: 0, pulled: 0 }
    if (!fetched.ref.content) return { ok: false, message: '云端还没有数据快照', pushed: 0, pulled: 0 }
    const remote = snapshotToRemote(fetched.ref.content)
    const empty = new Map<StoreName, Map<string, LocalEntry>>()
    STORES.forEach((store) => empty.set(store, new Map()))
    const { applies } = mergeStores(empty, remote)
    pauseSync()
    try { await applyLocal(applies) } finally { resumeSync() }
    emitSyncApplied()
    return { ok: true, message: `已从 GitHub 恢复 ${applies.length} 项`, pushed: 0, pulled: applies.length }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : '恢复失败', pushed: 0, pulled: 0 }
  }
}

/** 单条写入后的即时上云推送：防抖后走一次完整双向同步（含删除） */
let pushTimer: number | null = null
addSyncHook(() => {
  if (!isGitHubConfigured()) return
  if (pushTimer != null) window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    pushTimer = null
    void githubSyncNow()
  }, 1200)
})
