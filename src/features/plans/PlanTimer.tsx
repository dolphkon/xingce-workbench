import { useEffect, useState } from 'react'
import { Icon } from '../../components/ui'
import { accuracyOf, addSession, secondsOf, subTaskSeconds } from '../../lib/plans'
import { formatClock, uid } from '../../lib/utils'
import type { StudyPlan } from '../../types'
import { MODULE_COLORS } from './PlanForm'

interface Props {
  plan: StudyPlan
  onClose: () => void
  onUpdate: (plan: StudyPlan) => void
}

const RING_RADIUS = 84
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
type SubTaskStatus = '待完成' | '专注中' | '已完成'

export default function PlanTimer({ plan, onClose, onUpdate }: Props) {
  const [now, setNow] = useState(Date.now())
  const [note, setNote] = useState(plan.description)
  const [noteSaved, setNoteSaved] = useState(false)
  const [totalInput, setTotalInput] = useState(String(plan.questionCount ?? ''))
  const [correctInput, setCorrectInput] = useState(String(plan.correctCount ?? ''))
  const [resultSaved, setResultSaved] = useState(false)
  const [makeupMinutes, setMakeupMinutes] = useState('')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const color = MODULE_COLORS[plan.module]
  const isPractice = plan.mode === '刷题'
  const running = Boolean(plan.timerStartedAt)
  const activeId = plan.activeSubTaskId ?? plan.subTasks[0]?.id
  const activeTask = plan.subTasks.find((task) => task.id === activeId)
  // 顶部时间跟随当前专注子任务，与下方进度保持一致；总用时单独展示
  const displaySeconds = activeTask ? subTaskSeconds(plan, activeTask.id, now) : secondsOf(plan, now)
  const totalSeconds = secondsOf(plan, now)
  const targetSeconds = !isPractice && activeTask && activeTask.count > 0
    ? activeTask.count * 60
    : (plan.targetMinutes ?? 25) * 60
  const progress = targetSeconds > 0 ? Math.min(1, displaySeconds / targetSeconds) : 0
  const accuracy = accuracyOf(plan)

  const persist = (next: StudyPlan) => onUpdate({ ...next, updatedAt: Date.now() })

  const stopTimer = (complete = false): StudyPlan => {
    if (!plan.timerStartedAt) return { ...plan, completed: complete || plan.completed }
    const seconds = Math.max(0, Math.floor((now - plan.timerStartedAt) / 1000))
    const next: StudyPlan = {
      ...plan,
      elapsedSeconds: Math.max(0, plan.elapsedSeconds) + seconds,
      timerStartedAt: undefined,
      completed: complete || plan.completed,
      sessions: [
        ...(plan.sessions ?? []),
        { id: uid(), startedAt: plan.timerStartedAt, endedAt: now, seconds, subTaskId: activeId },
      ],
    }
    if (activeId) {
      next.subTasks = plan.subTasks.map((task) =>
        task.id === activeId ? { ...task, elapsedSeconds: (task.elapsedSeconds ?? 0) + seconds } : task,
      )
    }
    return next
  }

  const toggleTimer = () => {
    if (running) {
      persist(stopTimer())
      return
    }
    persist({
      ...plan,
      timerStartedAt: Date.now(),
      activeSubTaskId: activeId,
      completed: false,
    })
    setNow(Date.now())
  }

  const finish = () => {
    persist(stopTimer(true))
    onClose()
  }

  const adjust = (deltaSeconds: number) => {
    const next = addSession(
      {
        ...plan,
        elapsedSeconds: Math.max(0, plan.elapsedSeconds + deltaSeconds),
        subTasks: activeId
          ? plan.subTasks.map((task) =>
              task.id === activeId ? { ...task, elapsedSeconds: Math.max(0, (task.elapsedSeconds ?? 0) + deltaSeconds) } : task,
            )
          : plan.subTasks,
      },
      { id: uid(), seconds: deltaSeconds, endedAt: Date.now(), manual: true, subTaskId: activeId },
    )
    persist(next)
  }

  const submitMakeup = () => {
    const minutes = Number(makeupMinutes)
    if (!Number.isFinite(minutes) || minutes === 0) return
    adjust(Math.round(minutes * 60))
    setMakeupMinutes('')
  }

  /** 用户可自主切换子任务状态：待完成 / 专注中 / 已完成 */
  const setSubTaskStatus = (taskId: string, status: SubTaskStatus) => {
    let base = plan
    // 切换专注目标或结束当前目标时，先把正在计时的部分结算到原目标
    if (running && (status === '专注中' ? activeId !== taskId : taskId === activeId)) {
      base = stopTimer()
    }
    let activeSubTaskId = base.activeSubTaskId
    if (status === '专注中') activeSubTaskId = taskId
    else if (taskId === activeId) activeSubTaskId = undefined
    persist({
      ...base,
      activeSubTaskId,
      subTasks: base.subTasks.map((task) =>
        task.id === taskId ? { ...task, done: status === '已完成' } : task,
      ),
    })
  }

  const savePracticeResult = () => {
    const total = Math.max(0, Number(totalInput) || 0)
    const correct = Math.max(0, Number(correctInput) || 0)
    if (correct > total && total > 0) return
    persist({ ...plan, questionCount: total || undefined, correctCount: correct || undefined })
    setResultSaved(true)
    window.setTimeout(() => setResultSaved(false), 2000)
  }

  const saveNote = () => {
    persist({ ...plan, description: note.slice(0, 500) })
    setNoteSaved(true)
    window.setTimeout(() => setNoteSaved(false), 2000)
  }

  return (
    <div className="timer-panel">
      <div className="timer-head">
        <span className="plan-module-icon" style={{ background: color.bg, color: color.color }}>{plan.module.slice(0, 1)}</span>
        <div className="timer-head-main">
          <div className="timer-title">{plan.title}</div>
          <div className="timer-sub">
            <span className="chip" style={{ background: color.bg, color: color.color, borderColor: 'transparent' }}>{plan.module}</span>
            <span className={`chip ${isPractice ? 'chip-warning' : 'chip-primary'}`}>{isPractice ? '刷题' : '专项学习'}</span>
            {plan.source && <span className="chip"><Icon name="book" size={11} /> {plan.source}</span>}
            {plan.startTime && <span className="chip"><Icon name="clock" size={11} /> {plan.startTime}</span>}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭"><Icon name="x" size={20} /></button>
      </div>

      <div className="timer-ring-wrap">
        <svg className="timer-ring" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r={RING_RADIUS} fill="none" stroke="var(--surface-muted)" strokeWidth="10" />
          <circle
            cx="100" cy="100" r={RING_RADIUS} fill="none" stroke={color.color} strokeWidth="10"
            strokeLinecap="round" transform="rotate(-90 100 100)"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH * (1 - progress)}
            style={{ transition: 'stroke-dashoffset .5s linear' }}
          />
        </svg>
        <div className="timer-ring-content">
          <span className="timer-status">
            {running
              ? `专注中 · ${activeTask?.type ?? '整项任务'}`
              : displaySeconds > 0
                ? `已暂停 · ${activeTask?.type ?? '整项任务'}`
                : activeTask
                  ? `待开始 · ${activeTask.type}`
                  : '准备开始'}
          </span>
          <strong className="timer-clock">{formatClock(displaySeconds)}</strong>
          <span className="timer-target">目标 {Math.round(targetSeconds / 60)} 分钟 · {Math.round(progress * 100)}%</span>
          <span className="timer-total">累计总用时 {formatClock(totalSeconds)}</span>
        </div>
      </div>

      <div className="timer-controls">
        <button className={`btn ${running ? '' : 'btn-primary'} timer-main-btn`} onClick={toggleTimer}>
          <Icon name={running ? 'pause' : 'play'} size={17} /> {running ? '暂停计时' : displaySeconds > 0 ? '继续计时' : '开始计时'}
        </button>
        <button className="btn btn-primary" onClick={finish}><Icon name="check" size={17} /> 完成</button>
      </div>
      <div className="timer-adjust">
        <button className="btn btn-sm" onClick={() => adjust(-300)}>-5 分钟</button>
        <button className="btn btn-sm" onClick={() => adjust(300)}>+5 分钟</button>
        <div className="timer-makeup">
          <input
            className="input"
            type="number"
            value={makeupMinutes}
            onChange={(event) => setMakeupMinutes(event.target.value)}
            placeholder="补录分钟（可负）"
          />
          <button className="btn btn-sm" onClick={submitMakeup}>补录</button>
        </div>
      </div>

      {isPractice && (
        <div className="timer-section">
          <div className="timer-section-head">
            <strong>刷题结果</strong>
            <span className="small muted">随时录入，自动计算正确率</span>
          </div>
          <div className="timer-result-row">
            <label>总题量 <input className="input" type="number" min={0} value={totalInput} onChange={(event) => setTotalInput(event.target.value)} /></label>
            <label>做对 <input className="input" type="number" min={0} value={correctInput} onChange={(event) => setCorrectInput(event.target.value)} /></label>
            <button className="btn btn-sm" onClick={savePracticeResult}>
              <Icon name={resultSaved ? 'check' : 'save'} size={13} /> {resultSaved ? '已保存' : '保存结果'}
            </button>
            <span className="timer-accuracy">正确率 <strong>{accuracy}%</strong></span>
          </div>
        </div>
      )}

      {plan.subTasks.length > 0 && (
        <div className="timer-section">
          <div className="timer-section-head">
            <strong>{isPractice ? '题型进度' : '章节进度'}</strong>
            <span className="small muted">在下拉框中选择待完成 / 专注中 / 已完成</span>
          </div>
          <div className="timer-subtasks">
            {plan.subTasks.map((task) => {
              const status: SubTaskStatus = task.done ? '已完成' : activeId === task.id ? '专注中' : '待完成'
              return (
                <div className={`timer-subtask${status === '专注中' ? ' focused' : ''}${status === '已完成' ? ' completed' : ''}`} key={task.id}>
                  <span className={`subtask-status-dot ${status === '专注中' ? 'active' : status === '已完成' ? 'done' : 'pending'}`} />
                  <div className="timer-subtask-main">
                    <div className="timer-subtask-title">{task.type}</div>
                    <div className="small muted">
                      {isPractice ? `${task.count} 题 · 做对 ${task.correct ?? 0}` : `预计 ${task.count} 分钟`}
                      {' · '}用时 {formatClock(subTaskSeconds(plan, task.id, now))}
                    </div>
                  </div>
                  <select
                    className="select subtask-status"
                    value={status}
                    onChange={(event) => setSubTaskStatus(task.id, event.target.value as SubTaskStatus)}
                    aria-label={`${task.type} 状态`}
                  >
                    <option value="待完成">待完成</option>
                    <option value="专注中">专注中</option>
                    <option value="已完成">已完成</option>
                  </select>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="timer-section">
        <div className="timer-section-head"><strong>学习记录</strong></div>
        <textarea
          className="textarea"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={isPractice ? '记录易错题型、复盘要点…' : '记录学到的方法、待复盘知识点…'}
          style={{ minHeight: 70 }}
        />
        <div className="timer-note-actions">
          <button className="btn btn-sm" onClick={saveNote}>
            <Icon name={noteSaved ? 'check' : 'save'} size={13} /> {noteSaved ? '已保存' : '保存记录'}
          </button>
        </div>
      </div>
    </div>
  )
}
