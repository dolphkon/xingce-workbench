import { useEffect, useMemo, useState } from 'react'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import { cachePlan, deletePlan, loadPlans, mirrorPlan, normalizeMode, secondsOf } from '../../lib/plans'
import { dateKey, formatClock, formatHours, uid, weekOf } from '../../lib/utils'
import type { StudyPlan } from '../../types'
import PlanForm, { MODULE_COLORS } from './PlanForm'
import PlanStats from './PlanStats'
import PlanTimer from './PlanTimer'

type View = 'list' | 'timeline' | 'stats'
type ModeFilter = '全部' | '学习' | '刷题'

export default function PlansPage() {
  const [plans, setPlans] = useState<StudyPlan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [anchor, setAnchor] = useState(() => new Date())
  const [selected, setSelected] = useState(() => dateKey(new Date()))
  const [view, setView] = useState<View>('list')
  const [modeFilter, setModeFilter] = useState<ModeFilter>('全部')
  const [editing, setEditing] = useState<StudyPlan | 'new' | null>(null)
  const [timing, setTiming] = useState<StudyPlan | null>(null)
  const [menuFor, setMenuFor] = useState<StudyPlan | null>(null)
  const [deleting, setDeleting] = useState<StudyPlan | null>(null)
  const [makeupFor, setMakeupFor] = useState<StudyPlan | null>(null)
  const [makeupMinutes, setMakeupMinutes] = useState('')
  const [now, setNow] = useState(Date.now())

  const refresh = async () => {
    setLoading(true)
    try {
      const data = await loadPlans()
      setPlans(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '计划加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])
  const hasRunning = plans.some((plan) => plan.timerStartedAt)
  useEffect(() => {
    if (!hasRunning) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasRunning])

  const persist = (plan: StudyPlan) => {
    const next = { ...plan, updatedAt: Date.now() }
    cachePlan(next)
    setPlans((prev) => prev.map((item) => (item.id === next.id ? next : item)))
    setMenuFor((current) => (current?.id === next.id ? next : current))
    setTiming((current) => (current?.id === next.id ? next : current))
    void mirrorPlan(next)
  }

  const days = useMemo(() => weekOf(anchor), [anchor])
  const monthLabel = days[0].getMonth() === days[6].getMonth()
    ? `${anchor.getMonth() + 1}月${days[0].getDate()}日-${days[6].getDate()}日`
    : `${days[0].getMonth() + 1}月${days[0].getDate()}日-${days[6].getMonth() + 1}月${days[6].getDate()}日`

  const dayPlans = plans
    .filter((plan) => plan.date === selected && (modeFilter === '全部' || normalizeMode(plan.mode) === modeFilter))
    .sort((a, b) => {
      if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime)
      if (a.startTime) return -1
      if (b.startTime) return 1
      return b.createdAt - a.createdAt
    })
  const doneCount = dayPlans.filter((plan) => plan.completed).length
  const daySeconds = plans.filter((plan) => plan.date === selected).reduce((sum, plan) => sum + secondsOf(plan, now), 0)

  const shiftWeek = (delta: number) => {
    const next = new Date(anchor)
    next.setDate(next.getDate() + delta * 7)
    setAnchor(next)
  }
  const goToday = () => {
    const today = new Date()
    setAnchor(today)
    setSelected(dateKey(today))
  }

  const toggleTimer = (plan: StudyPlan) => {
    if (plan.timerStartedAt) {
      const seconds = Math.max(0, Math.floor((now - plan.timerStartedAt) / 1000))
      const activeId = plan.activeSubTaskId ?? plan.subTasks[0]?.id
      persist({
        ...plan,
        elapsedSeconds: plan.elapsedSeconds + seconds,
        timerStartedAt: undefined,
        sessions: [...(plan.sessions ?? []), { id: uid(), startedAt: plan.timerStartedAt, endedAt: now, seconds, subTaskId: activeId }],
        subTasks: activeId
          ? plan.subTasks.map((task) => task.id === activeId ? { ...task, elapsedSeconds: (task.elapsedSeconds ?? 0) + seconds } : task)
          : plan.subTasks,
      })
    } else {
      persist({ ...plan, timerStartedAt: Date.now(), completed: false })
      setNow(Date.now())
    }
    setMenuFor(null)
  }

  const toggleComplete = (plan: StudyPlan) => {
    if (plan.completed) {
      persist({ ...plan, completed: false })
      return
    }
    const seconds = plan.timerStartedAt ? Math.max(0, Math.floor((now - plan.timerStartedAt) / 1000)) : 0
    persist({
      ...plan,
      completed: true,
      elapsedSeconds: plan.elapsedSeconds + seconds,
      timerStartedAt: undefined,
      sessions: seconds > 0
        ? [...(plan.sessions ?? []), { id: uid(), startedAt: plan.timerStartedAt, endedAt: now, seconds }]
        : plan.sessions,
    })
  }

  const duplicate = (plan: StudyPlan) => {
    const timestamp = Date.now()
    const copy: StudyPlan = {
      ...plan,
      id: uid(),
      title: `${plan.title}（副本）`,
      completed: false,
      elapsedSeconds: 0,
      timerStartedAt: undefined,
      sessions: [],
      activeSubTaskId: undefined,
      subTasks: plan.subTasks.map((task) => ({ ...task, id: uid(), elapsedSeconds: 0, done: false })),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    cachePlan(copy)
    void mirrorPlan(copy)
    setPlans((prev) => [...prev, copy])
    setMenuFor(null)
  }

  const submitMakeup = () => {
    if (!makeupFor) return
    const minutes = Number(makeupMinutes)
    if (!Number.isFinite(minutes) || minutes === 0) return
    const seconds = Math.round(minutes * 60)
    const activeId = makeupFor.activeSubTaskId ?? makeupFor.subTasks[0]?.id
    persist({
      ...makeupFor,
      elapsedSeconds: Math.max(0, makeupFor.elapsedSeconds + seconds),
      sessions: [...(makeupFor.sessions ?? []), { id: uid(), seconds, endedAt: Date.now(), manual: true, subTaskId: activeId }],
      subTasks: activeId
        ? makeupFor.subTasks.map((task) => task.id === activeId ? { ...task, elapsedSeconds: Math.max(0, (task.elapsedSeconds ?? 0) + seconds) } : task)
        : makeupFor.subTasks,
    })
    setMakeupFor(null)
    setMakeupMinutes('')
  }

  const handleDelete = async () => {
    if (!deleting) return
    await deletePlan(deleting.id)
    setPlans((prev) => prev.filter((item) => item.id !== deleting.id))
    setDeleting(null)
  }

  const planCard = (plan: StudyPlan) => {
    const color = MODULE_COLORS[plan.module]
    const mode = normalizeMode(plan.mode)
    const running = Boolean(plan.timerStartedAt)
    const seconds = secondsOf(plan, now)
    return (
      <div className={`plan-item${plan.completed ? ' done' : ''}`} key={plan.id}>
        <button
          className={`plan-check${plan.completed ? ' checked' : ''}`}
          onClick={() => toggleComplete(plan)}
          title={plan.completed ? '标记为未完成' : '标记为已完成'}
          aria-label="切换完成状态"
        >
          {plan.completed && <Icon name="check" size={13} />}
        </button>
        <span className="plan-module-icon" style={{ background: color.bg, color: color.color }}>{plan.module.slice(0, 1)}</span>
        <div className="plan-main" onClick={() => setTiming(plan)} title="打开专注计时">
          <div className="plan-title">{plan.title}</div>
          <div className="plan-meta">
            <span className="chip" style={{ background: color.bg, color: color.color, borderColor: 'transparent' }}>{plan.module}</span>
            <span className={`chip ${mode === '学习' ? 'chip-primary' : 'chip-warning'}`}>{mode === '学习' ? (plan.source || '专项学习') : '刷题'}</span>
            {plan.startTime && <span className="chip"><Icon name="clock" size={11} /> {plan.startTime}{plan.endTime ? `-${plan.endTime}` : ''}</span>}
            {mode === '学习' && plan.targetMinutes ? (
              <span className="plan-progress-chip">
                <span className="plan-progress-track"><span style={{ width: `${Math.min(100, (seconds / (plan.targetMinutes * 60)) * 100)}%`, background: color.color }} /></span>
                {Math.round(seconds / 60)}/{plan.targetMinutes} 分
              </span>
            ) : null}
            {mode === '刷题' && plan.questionCount ? (
              <span className="chip"><Icon name="target" size={11} /> {plan.correctCount ?? 0}/{plan.questionCount} 题 · {Math.round(((plan.correctCount ?? 0) / plan.questionCount) * 100)}%</span>
            ) : null}
            {plan.subTasks.length > 0 && <span className="chip"><Icon name="list" size={11} /> {plan.subTasks.filter((task) => task.done).length}/{plan.subTasks.length} 子项</span>}
            {running && <span className="chip chip-success"><Icon name="bolt" size={11} /> 计时中</span>}
            <span className={`plan-timer-text${running ? ' running' : ''}`}><Icon name="clock" size={11} /> {formatClock(seconds)}</span>
          </div>
        </div>
        <button
          className={`plan-timer-btn${running ? ' running' : ''}`}
          onClick={() => setTiming(plan)}
          title={running ? '查看计时' : '开始专注计时'}
        >
          <Icon name={running ? 'clock' : 'play'} size={14} />
          <span>{running ? formatClock(seconds) : '专注'}</span>
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
          <p className="page-subtitle">专项学习记录投入，刷题记录正确率，每一步都算数</p>
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
            const seconds = plans.filter((plan) => plan.date === key).reduce((sum, plan) => sum + secondsOf(plan, now), 0)
            const done = plans.filter((plan) => plan.date === key && plan.completed).length
            return (
              <button
                key={key}
                className={`week-day${key === selected ? ' active' : ''}${isToday ? ' today' : ''}`}
                onClick={() => { setSelected(key); setView('list') }}
              >
                <span className="week-day-label">{'日一二三四五六'[day.getDay()]}</span>
                <span className="week-day-num">{day.getDate()}</span>
                <span className="week-day-meta">{seconds > 0 ? formatHours(seconds) : done > 0 ? `${done} 项` : '·'}</span>
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
        {view !== 'stats' && (
          <div className="segmented">
            {(['全部', '学习', '刷题'] as ModeFilter[]).map((item) => (
              <button key={item} className={modeFilter === item ? 'active' : ''} onClick={() => setModeFilter(item)}>{item}</button>
            ))}
          </div>
        )}
        <span className="spacer" />
        <span className="small muted">{selected} · {dayPlans.length} 项 · 完成 {doneCount} · 用时 {formatHours(daySeconds)}</span>
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
            description="新建学习任务，开始今天的备考吧"
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
            onSaved={() => { setEditing(null); void refresh() }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {timing && (
        <Modal title="专注计时" onClose={() => setTiming(null)} wide>
          <PlanTimer plan={timing} onClose={() => setTiming(null)} onUpdate={persist} />
        </Modal>
      )}

      {menuFor && (
        <Modal title={menuFor.title} onClose={() => setMenuFor(null)}>
          <div className="action-sheet">
            <button onClick={() => { setEditing(menuFor); setMenuFor(null) }}><Icon name="edit" size={17} /> 编辑任务</button>
            <button onClick={() => { setTiming(menuFor); setMenuFor(null) }}><Icon name="play" size={17} /> 打开专注计时</button>
            <button onClick={() => toggleTimer(menuFor)}>
              <Icon name={menuFor.timerStartedAt ? 'pause' : 'play'} size={17} />
              {menuFor.timerStartedAt ? '暂停计时（快速）' : '开始计时（快速）'}
            </button>
            <button onClick={() => { setMakeupFor(menuFor); setMakeupMinutes(''); setMenuFor(null) }}><Icon name="clock" size={17} /> 补录用时</button>
            <button onClick={() => { toggleComplete(menuFor); setMenuFor(null) }}><Icon name="check" size={17} /> {menuFor.completed ? '标记未完成' : '标记已完成'}</button>
            <button onClick={() => duplicate(menuFor)}><Icon name="copy" size={17} /> 复制计划</button>
            <button className="danger" onClick={() => { setDeleting(menuFor); setMenuFor(null) }}><Icon name="trash" size={17} /> 删除任务</button>
            <button className="cancel" onClick={() => setMenuFor(null)}>取消</button>
          </div>
        </Modal>
      )}

      {makeupFor && (
        <Modal title="补录用时" onClose={() => setMakeupFor(null)}>
          <div className="form-field">
            <label className="form-label">补充分钟数（输入负数可扣减）</label>
            <input
              className="input"
              type="number"
              autoFocus
              value={makeupMinutes}
              onChange={(event) => setMakeupMinutes(event.target.value)}
              placeholder="如：25 或 -10"
            />
            <span className="form-hint">补录后会记入统计，并计入当前专注的子任务。</span>
          </div>
          <div className="form-actions">
            <button className="btn" onClick={() => setMakeupFor(null)}>取消</button>
            <button className="btn btn-primary" onClick={submitMakeup}>确认补录</button>
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
