import { listAll, put, remove } from './db'
import { dateKey } from './utils'
import type { PlanMode, PlanSession, StudyPlan } from '../types'

/**
 * 学习计划使用「本地缓存优先 + IndexedDB 镜像」的双写策略：
 * - 点击保存/计时立即写入 localStorage，界面绝不卡在「保存中」
 * - IndexedDB 写入异步进行并带超时，即使浏览器数据库异常也不影响使用
 * - 读取时两边合并，本地缓存优先，避免数据库阻塞导致空白页
 */
const LS_KEY = 'xingce-plans-v1'
const TOMBSTONE_KEY = 'xingce-plans-deleted-v1'
const WRITE_TIMEOUT = 1500

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => window.setTimeout(() => resolve(fallback), ms)),
  ])
}

export function normalizeMode(mode: PlanMode): '学习' | '刷题' {
  return mode === '刷题' ? '刷题' : '学习'
}

export function normalizePlan(plan: StudyPlan): StudyPlan {
  return {
    ...plan,
    mode: normalizeMode(plan.mode),
    subTasks: (plan.subTasks ?? []).map((task) => ({
      ...task,
      count: Number(task.count) || 0,
      correct: task.correct == null ? undefined : Math.max(0, Number(task.correct) || 0),
      elapsedSeconds: Math.max(0, Number(task.elapsedSeconds) || 0),
    })),
    elapsedSeconds: Math.max(0, Number(plan.elapsedSeconds) || 0),
    sessions: plan.sessions ?? [],
  }
}

function readLocal(): StudyPlan[] {
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StudyPlan[]).map(normalizePlan) : []
  } catch {
    return []
  }
}

function writeLocal(plans: StudyPlan[]): boolean {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(plans))
    return true
  } catch {
    return false
  }
}

/** 删除标记：防止数据库删除失败后旧计划被重新合并回来 */
function readTombstones(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TOMBSTONE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writeTombstones(ids: string[]) {
  try {
    window.localStorage.setItem(TOMBSTONE_KEY, JSON.stringify(Array.from(new Set(ids))))
  } catch {
    // 存储不可用时忽略
  }
}

/** 读取计划：本地缓存 + 数据库合并，任一侧异常都能正常工作 */
export async function loadPlans(): Promise<StudyPlan[]> {
  const local = readLocal()
  const remote = await withTimeout(
    listAll('plans').then((list) => list.map(normalizePlan)).catch(() => [] as StudyPlan[]),
    WRITE_TIMEOUT,
    [] as StudyPlan[],
  )
  const merged = new Map<string, StudyPlan>()
  const deleted = new Set(readTombstones())
  remote.forEach((plan) => { if (!deleted.has(plan.id)) merged.set(plan.id, plan) })
  local.forEach((plan) => { if (!deleted.has(plan.id)) merged.set(plan.id, plan) }) // 本地写入更新，优先保留
  const result = Array.from(merged.values())
  writeLocal(result)
  return result
}

/** 同步写入本地缓存：保存按钮点击后立即生效，界面不会卡在「保存中」 */
export function cachePlan(plan: StudyPlan): boolean {
  const record = normalizePlan(plan)
  writeTombstones(readTombstones().filter((id) => id !== record.id))
  return writeLocal(readLocal().filter((item) => item.id !== record.id).concat(record))
}

/** 异步镜像到 IndexedDB，失败也不影响主流程 */
export async function mirrorPlan(plan: StudyPlan): Promise<boolean> {
  return withTimeout(
    put('plans', normalizePlan(plan)).then(() => true).catch(() => false),
    WRITE_TIMEOUT,
    false,
  )
}

/** 保存单个计划 */
export async function savePlan(plan: StudyPlan): Promise<{ cached: boolean; persisted: boolean }> {
  const cached = cachePlan(plan)
  const persisted = await mirrorPlan(plan)
  return { cached, persisted }
}

/** 批量写入（导入备份使用） */
export async function savePlans(plans: StudyPlan[]): Promise<void> {
  const records = plans.map(normalizePlan)
  if (records.length > 0) {
    const map = new Map(readLocal().map((plan) => [plan.id, plan]))
    records.forEach((plan) => map.set(plan.id, plan))
    writeLocal(Array.from(map.values()))
    writeTombstones(readTombstones().filter((id) => !records.some((plan) => plan.id === id)))
  }
  await withTimeout(
    Promise.all(records.map((plan) => put('plans', plan))).then(() => true).catch(() => false),
    WRITE_TIMEOUT * 2,
    false,
  )
}

export async function deletePlan(id: string): Promise<void> {
  writeTombstones([...readTombstones(), id])
  writeLocal(readLocal().filter((plan) => plan.id !== id))
  await withTimeout(remove('plans', id).then(() => true).catch(() => false), WRITE_TIMEOUT, false)
}

export async function clearPlans(): Promise<void> {
  const stored = await withTimeout(listAll('plans').catch(() => [] as StudyPlan[]), WRITE_TIMEOUT, [] as StudyPlan[])
  const ids = Array.from(new Set([...readLocal().map((plan) => plan.id), ...stored.map((plan) => plan.id)]))
  writeTombstones(ids)
  writeLocal([])
  await withTimeout(
    Promise.all(ids.map((id) => remove('plans', id))).then(() => true).catch(() => false),
    WRITE_TIMEOUT * 2,
    false,
  )
}

/* ---------- 统计与计时辅助 ---------- */

export function secondsOf(plan: StudyPlan, now = Date.now()): number {
  const running = plan.timerStartedAt ? Math.max(0, Math.floor((now - plan.timerStartedAt) / 1000)) : 0
  return Math.max(0, plan.elapsedSeconds) + running
}

export function subTaskSeconds(plan: StudyPlan, taskId: string, now = Date.now()): number {
  const task = (plan.subTasks ?? []).find((item) => item.id === taskId)
  const base = Math.max(0, Number(task?.elapsedSeconds) || 0)
  const running = plan.timerStartedAt && plan.activeSubTaskId === taskId
    ? Math.max(0, Math.floor((now - plan.timerStartedAt) / 1000))
    : 0
  return base + running
}

export function accuracyOf(plan: StudyPlan): number {
  const total = plan.questionCount ?? (plan.subTasks ?? []).reduce((sum, task) => sum + task.count, 0)
  const correct = plan.correctCount ?? (plan.subTasks ?? []).reduce((sum, task) => sum + (task.correct ?? 0), 0)
  return total > 0 ? Math.min(100, Math.max(0, Math.round((correct / total) * 100))) : 0
}

export function addSession(plan: StudyPlan, session: PlanSession): StudyPlan {
  return { ...plan, sessions: [...(plan.sessions ?? []), session] }
}

/** 按日期统计时长（秒）；兼容没有 sessions 字段的旧数据 */
export function secondsByDate(plans: StudyPlan[]): Record<string, number> {
  const result: Record<string, number> = {}
  plans.forEach((plan) => {
    const sessions = plan.sessions ?? []
    if (sessions.length === 0) {
      if (plan.elapsedSeconds > 0) result[plan.date] = (result[plan.date] ?? 0) + plan.elapsedSeconds
      return
    }
    sessions.forEach((session) => {
      const key = dateKey(new Date(session.endedAt ?? session.startedAt ?? Date.now()))
      // 负数为扣减用时的补录，同样要计入当天统计
      result[key] = (result[key] ?? 0) + session.seconds
    })
    // 正在计时的部分也实时计入今日统计
    if (plan.timerStartedAt) {
      const key = dateKey(new Date())
      result[key] = (result[key] ?? 0) + Math.max(0, Math.floor((Date.now() - plan.timerStartedAt) / 1000))
    }
  })
  Object.keys(result).forEach((key) => {
    if (result[key] < 0) result[key] = 0
  })
  return result
}

export function durationText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  if (total > 0 && total < 60) return `${total} 秒`
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h === 0) return `${m} 分钟`
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}
