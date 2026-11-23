import { useSyncExternalStore } from 'react'
import {
  clearGitHubConfig, ensureBranch, fetchAuthenticatedUser, githubPullAll, githubPushAll,
  githubSyncNow, GITHUB_DEFAULTS, isGitHubConfigured, readGitHubConfig, testGitHubConfig,
  writeGitHubConfig, type GitHubConfig, type SyncResult,
} from './github'

/**
 * 模块级共享状态：侧栏与顶栏共用一个同步实例与定时器，避免重复拉取/推送。
 */
interface GithubState {
  config: GitHubConfig | null
  syncing: boolean
  lastResult: string | null
  configOpen: boolean
}

let state: GithubState = {
  config: readGitHubConfig(),
  syncing: false,
  lastResult: null,
  configOpen: false,
}

const listeners = new Set<() => void>()
function emit(): void { listeners.forEach((fn) => fn()) }
function set(patch: Partial<GithubState>): void {
  state = { ...state, ...patch }
  emit()
}
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
function snapshot(): GithubState { return state }

let busy = false
let timerStarted = false

async function runSync(manual = false): Promise<void> {
  if (busy || !isGitHubConfigured()) return
  busy = true
  set({ syncing: true })
  try {
    const result: SyncResult = await githubSyncNow()
    if (manual || !result.ok) set({ lastResult: result.message })
  } finally {
    busy = false
    set({ syncing: false })
  }
}

function ensureTimer(): void {
  if (timerStarted) return
  timerStarted = true
  window.setInterval(() => { void runSync() }, 30_000)
  const onVisible = () => {
    const cfg = readGitHubConfig()
    if (cfg && (cfg.owner !== state.config?.owner || cfg.repo !== state.config?.repo)) set({ config: cfg })
    if (document.visibilityState === 'visible') void runSync()
  }
  document.addEventListener('visibilitychange', onVisible)
  // 已配置时首次进入拉取其它设备的更新
  if (state.config) void runSync()
}

if (typeof window !== 'undefined') ensureTimer()

export interface GithubSyncApi {
  configured: boolean
  config: GitHubConfig | null
  syncing: boolean
  lastResult: string | null
  configOpen: boolean
  openConfig: () => void
  closeConfig: () => void
  saveConfig: (config: GitHubConfig, mode?: 'merge' | 'push') => Promise<{ ok: boolean; message: string }>
  /** 一键连接：仅需令牌，自动识别用户名并套用私有仓库 / data 分支约定 */
  connect: (token: string, mode?: 'merge' | 'push') => Promise<{ ok: boolean; message: string }>
  sync: (manual?: boolean) => Promise<void>
  pushAll: () => Promise<void>
  pullAll: () => Promise<void>
  disconnect: () => void
}

async function connect(token: string, mode: 'merge' | 'push' = 'merge'): Promise<{ ok: boolean; message: string }> {
  const clean = token.trim()
  if (!clean) return { ok: false, message: '请先粘贴访问令牌' }
  const user = await fetchAuthenticatedUser(clean)
  if (!user.ok) return { ok: false, message: user.message }
  const next: GitHubConfig = {
    owner: user.login,
    repo: GITHUB_DEFAULTS.repo,
    branch: GITHUB_DEFAULTS.branch,
    path: GITHUB_DEFAULTS.path,
    token: clean,
  }
  return saveConfig(next, mode)
}

async function saveConfig(next: GitHubConfig, mode: 'merge' | 'push' = 'merge'): Promise<{ ok: boolean; message: string }> {
  const check = await testGitHubConfig(next)
  if (!check.ok) return check
  const branch = await ensureBranch(next)
  if (!branch.ok) return branch
  writeGitHubConfig(next)
  set({ config: next })
  const result = mode === 'push' ? await githubPushAll(next) : await githubSyncNow(next)
  set({ lastResult: result.message })
  return result
}

async function pushAll(): Promise<void> {
  if (busy || !isGitHubConfigured()) return
  busy = true
  set({ syncing: true })
  try {
    const result = await githubPushAll()
    set({ lastResult: result.message })
  } finally {
    busy = false
    set({ syncing: false })
  }
}

async function pullAll(): Promise<void> {
  if (busy || !isGitHubConfigured()) return
  busy = true
  set({ syncing: true })
  try {
    const result = await githubPullAll()
    set({ lastResult: result.message })
  } finally {
    busy = false
    set({ syncing: false })
  }
}

function disconnect(): void {
  clearGitHubConfig()
  set({ config: null, lastResult: '已断开 GitHub 同步' })
}

const api: GithubSyncApi = {
  get configured() { return state.config !== null },
  get config() { return state.config },
  get syncing() { return state.syncing },
  get lastResult() { return state.lastResult },
  get configOpen() { return state.configOpen },
  openConfig: () => set({ configOpen: true }),
  closeConfig: () => set({ configOpen: false }),
  saveConfig,
  connect,
  sync: runSync,
  pushAll,
  pullAll,
  disconnect,
}

export function useGitHubSync(): GithubSyncApi {
  useSyncExternalStore(subscribe, snapshot, snapshot)
  return api
}
