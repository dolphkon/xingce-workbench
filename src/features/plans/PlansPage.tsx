import { useEffect, useState } from 'react'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { put, remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { dateKey, formatClock, formatHours, uid, weekOf } from '../../lib/utils'
import type { StudyPlan } from '../../types'
import PlanForm, { MODULE_COLORS } from './PlanForm'
import PlanStats from './PlanStats'

type View = 'list' | 'timeline' | 'stats'

/** 当前累计秒数（含正在计时中的增量） */
function secondsOf(plan: StudyPlan): number {
  if (!plan.timerStartedAt) return plan.elapsedSeconds
  return plan.elapsedSeconds + Math.max(0, Math.floor((Date.now() - plan.timerStartedAt) / 1000))
}

export default function PlansPage() {
  const { items: plans, loading, error, refresh } = useCollection('plans')
  const [anchor, setAnchor] = useState(() => new Date())
  const [selected, setSelected] = useState(() => dateKey(new Date()))
  const [view, setView] = useState<View>('list')
  const [editing, setEditing] = useState<StudyPlan | 'new' | null>(null)
  const [menuFor, setMenuFor] = useState<StudyPlan | null>(null)
  const [deleting, setDeleting] = useState<StudyPlan | null>(null)
  const [tick, setTick] = useState(0)

  const hasRunning = plans.some((plan) => plan.timerStartedAt)
  useEffect(() => {
    if (!hasRunning) return
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [hasRunning])
  void tick // 触发实时计时重渲染

  const days = weekOf(anchor)
  const monthLabel = days[0].getMonth() === days[6].getMonth()
    ? `${anchor.getMonth() + 1}月${days[0].getDate()}日-${days[6].getDate()}日`
    : `${days[0].getMonth() + 1}月${days[0].getDate()}日-${days[6].getMonth() + 1}月${days[6].getDate()}日`

  const dayPlans = plans
    .filter((plan) => plan.date === selected)
    .sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
      if (a.startTime) return -1
      if (b.startTime) return 1
      return b.createdAt - a.createdAt
    })
  const doneCount = dayPlans.filter((plan) => plan.completed).length

  const shiftWeek = (delta: number) => {
    const next = new Date(anchor)
    next.setDate(next.getDate() + delta * 7)
    setAnchor(next)
  }
  const goToday = () => {
    const now = new Date()
    setAnchor(now)
    setSelected(dateKey(now))
  }

  const toggleTimer = async (plan: StudyPlan) => {
    const now = Date.now()
    if (plan.timerStartedAt) {
      await put('plans', {
        ...plan,
        elapsedSeconds: secondsOf(plan),
        timerStartedAt: undefined,
        updatedAt: now,
      })
    } else {
      await put('plans', { ...plan, timerStartedAt: now, updatedAt: now })
    }
    setMenuFor(null)
    refresh()
  }

  const toggleComplete = async (plan: StudyPlan) => {
    const now = Date.now()
    const completed = !plan.completed
    await put('plans', {
      ...plan,
      completed,
      elapsedSeconds: completed && plan.timerStartedAt ? secondsOf(plan) : plan.elapsedSeconds,
      timerStartedAt: completed ? undefined : plan.timerStartedAt,
      updatedAt: now,
    })
    refresh()
  }

  const duplicate = async (plan: StudyPlan) => {
    const now = Date.now()
    await put('plans', {
      ...plan,
      id: uid(),
      title: `${plan.title}（副本）`,
      completed: false,
      elapsedSeconds: 0,
      timerStartedAt: undefined,
      createdAt: now,
      updatedAt: now,
    })
    setMenuFor(null)
    refresh()
  }

  const handleDelete = async () => {
    if (!deleting) return
    await remove('plans', deleting.id)
    setDeleting(null)
    refresh()
  }

  const planCard = (plan: StudyPlan) => {
    const color = MODULE_COLORS[plan.module]
    const running = Boolean(plan.timerStartedAt)
    return (
      <div className={`plan-item${plan.completed ? ' done' : ''}`} key={plan.id}>
        <button
          className={`plan-check${plan.completed ? ' checked' : ''}`}
          onClick={() => void toggleComplete(plan)}
          title={plan.completed ? '标记为未完成' : '标记为已完成'}
          aria-label="切换完成状态"
        >
          {plan.completed && <Icon name="check" size={13} />}
        </button>
        <span className="plan-module-icon" style={{ background: color.bg, color: color.color }}>
          {plan.module.slice(0, 1)}
        </span>
        <div className="plan-main" onClick={() => setMenuFor(plan)}>
          <div className="plan-title">{plan.title}</div>
          <div className="plan-meta">
            <span className="chip" style={{ background: color.bg, color: color.color, borderColor: 'transparent' }}>{plan.module}</span>
            <span className={`chip ${plan.mode === '专注' ? 'chip-primary' : 'chip-warning'}`}>{plan.mode}</span>
            {plan.startTime && <span className="chip"><Icon name="clock" size={11} /> {plan.startTime}</span>}
            {plan.subTasks.length > 0 && <span className="chip"><Icon name="list" size={11} /> {plan.subTasks.length} 项拆解</span>}
            <span className={`plan-timer-text${running ? ' running' : ''}`}><Icon name="clock" size={11} /> {formatHours(secondsOf(plan))}</span>
          </div>
        </div>
        <button
          className={`plan-timer-btn${running ? ' running' : ''}`}
          onClick={() => void toggleTimer(plan)}
          title={running ? '暂停计时' : '开始计时'}
        >
          <Icon name={running ? 'pause' : 'play'} size={14} />
          <span>{running ? formatClock(secondsOf(plan)) : '计时'}</span>
        </button>
        <button className="icon-btn" onClick={() => setMenuFor(plan)} title="更多操作" aria-label="更多操作">
          <Icon name="more" size={17} />
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">学习计划</h1>
          <p className="page-subtitle">按模块规划每天的任务，专注与刷题都能计时追踪</p>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" size={16} /> 新建计划
          </button>
        </div>
      </div>

      <div className="week-card">
        <div className="week-head">
          <button className="icon-btn" onClick={() => shiftWeek(-1)} title="上一周" aria-label="上一周"><Icon name="back" size={16} /></button>
          <strong>{monthLabel}</strong>
          <button className="icon-btn" onClick={() => shiftWeek(1)} title="下一周" aria-label="下一周"><Icon name="chevron" size={16} /></button>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={goToday}><Icon name="refresh" size={13} /> 回到今天</button>
        </div>
        <div className="week-days">
          {days.map((day) => {
            const key = dateKey(day)
            const isToday = key === dateKey(new Date())
            return (
              <button
                key={key}
                className={`week-day${key === selected ? ' active' : ''}${isToday ? ' today' : ''}`}
                onClick={() => { setSelected(key); setView('list') }}
              >
                <span className="week-day-label">{'日一二三四五六'[day.getDay()]}</span>
                <span className="week-day-num">{day.getDate()}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="filter-bar">
        <div className="segmented">
          {(['list', 'timeline', 'stats'] as View[]).map((item) => (
            <button key={item} className={view === item ? 'active' : ''} onClick={() => setView(item)}>
              {item === 'list' ? '列表' : item === 'timeline' ? '时间轴' : '统计'}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="small muted">{selected} · {dayPlans.length} 项 · 完成 {doneCount}</span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="loading">加载中…</div>
      ) : view === 'stats' ? (
        <PlanStats plans={plans} />
      ) : dayPlans.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="calendar"
            title="这一天还没有计划"
            description="新建一个学习任务，开始今天的备考吧"
            action={
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
                <Icon name="plus" size={15} /> 新建计划
              </button>
            }
          />
        </div>
      ) : view === 'list' ? (
        <div className="card">
          <div className="card-body tight plan-list">{dayPlans.map(planCard)}</div>
        </div>
      ) : (
        <div className="card">
          <div className="card-body timeline">
            {dayPlans.map((plan) => (
              <div className="timeline-row" key={plan.id}>
                <div className="timeline-time">{plan.startTime ?? '全天'}</div>
                <div className="timeline-content">{planCard(plan)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="fab" onClick={() => setEditing('new')} title="新建计划" aria-label="新建计划">
        <Icon name="plus" size={24} />
      </button>

      {editing && (
        <Modal title={editing === 'new' ? '新建学习计划' : '编辑任务'} onClose={() => setEditing(null)} wide>
          <PlanForm
            initial={editing === 'new' ? undefined : editing}
            defaultDate={selected}
            onSaved={() => { setEditing(null); refresh() }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {menuFor && (
        <Modal title={menuFor.title} onClose={() => setMenuFor(null)}>
          <div className="action-sheet">
            <button onClick={() => { setEditing(menuFor); setMenuFor(null) }}><Icon name="edit" size={17} /> 编辑任务</button>
            <button onClick={() => void toggleTimer(menuFor)}>
              <Icon name={menuFor.timerStartedAt ? 'pause' : 'play'} size={17} />
              {menuFor.timerStartedAt ? '暂停计时' : '开始计时'}
            </button>
            <button onClick={() => void duplicate(menuFor)}><Icon name="copy" size={17} /> 复制计划</button>
            <button className="danger" onClick={() => { setDeleting(menuFor); setMenuFor(null) }}><Icon name="trash" size={17} /> 删除任务</button>
            <button className="cancel" onClick={() => setMenuFor(null)}>取消</button>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          message={`确定删除任务「${deleting.title.slice(0, 40)}${deleting.title.length > 40 ? '…' : ''}」吗？此操作不可撤销。`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </>
  )
}
