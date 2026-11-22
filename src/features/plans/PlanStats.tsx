import { Icon } from '../../components/ui'
import { durationText, normalizeMode, secondsOf, secondsByDate } from '../../lib/plans'
import { dateKey, formatClock } from '../../lib/utils'
import { STUDY_MODULES, type StudyPlan } from '../../types'
import { MODULE_COLORS } from './PlanForm'

interface DayStat { key: string; label: string; study: number; practice: number; date: Date }

function recentDays(count = 7): DayStat[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (count - 1 - index))
    return {
      key: dateKey(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      study: 0,
      practice: 0,
      date,
    }
  })
}

export default function PlanStats({ plans }: { plans: StudyPlan[] }) {
  const total = plans.length
  const completed = plans.filter((plan) => plan.completed).length
  const totalSeconds = plans.reduce((sum, plan) => sum + secondsOf(plan), 0)
  const byDate = secondsByDate(plans)
  const days = recentDays(7)
  days.forEach((day) => {
    const seconds = byDate[day.key] ?? 0
    // 按该日计划中学习/刷题的占比拆分，展示每日结构
    const dayPlans = plans.filter((plan) => plan.sessions?.some((session) => dateKey(new Date(session.endedAt ?? session.startedAt ?? 0)) === day.key)
      || (!plan.sessions?.length && plan.date === day.key))
    const studyWeight = dayPlans.filter((plan) => normalizeMode(plan.mode) === '学习').length
    const practiceWeight = dayPlans.length - studyWeight
    const weight = studyWeight + practiceWeight
    if (weight === 0) {
      day.study = seconds
    } else {
      day.study = Math.round((seconds * studyWeight) / weight)
      day.practice = seconds - day.study
    }
  })
  const weekSeconds = days.reduce((sum, day) => sum + day.study + day.practice, 0)
  const todaySeconds = byDate[dateKey(new Date())] ?? 0

  const practicePlans = plans.filter((plan) => normalizeMode(plan.mode) === '刷题')
  const questions = practicePlans.reduce((sum, plan) => sum + (plan.questionCount ?? 0), 0)
  const correct = practicePlans.reduce((sum, plan) => sum + (plan.correctCount ?? 0), 0)
  const accuracy = questions > 0 ? Math.round((correct / questions) * 100) : 0
  const rate = total ? Math.round((completed / total) * 100) : 0

  const byModule = STUDY_MODULES.map((module) => {
    const list = plans.filter((plan) => plan.module === module)
    return {
      module,
      count: list.length,
      done: list.filter((plan) => plan.completed).length,
      seconds: list.reduce((sum, plan) => sum + secondsOf(plan), 0),
    }
  })
  const maxSeconds = Math.max(1, ...byModule.map((item) => item.seconds))

  const byMode = [
    { label: '专项学习', seconds: plans.filter((plan) => normalizeMode(plan.mode) === '学习').reduce((sum, plan) => sum + secondsOf(plan), 0), color: '#4f46e5' },
    { label: '刷题', seconds: practicePlans.reduce((sum, plan) => sum + secondsOf(plan), 0), color: '#16a34a' },
  ]
  const modeMax = Math.max(1, ...byMode.map((item) => item.seconds))
  const chartMax = Math.max(1, ...days.map((day) => day.study + day.practice))

  const cards = [
    { label: '计划总数', value: String(total), icon: 'calendar', bg: '#eef2ff', color: '#4f46e5' },
    { label: '完成率', value: `${rate}%`, icon: 'target', bg: '#dcfce7', color: '#16a34a' },
    { label: '累计学习', value: durationText(totalSeconds), icon: 'clock', bg: '#e0f2fe', color: '#0284c7' },
    { label: '本周学习', value: durationText(weekSeconds), icon: 'chart', bg: '#fef3c7', color: '#d97706' },
    { label: '今日学习', value: durationText(todaySeconds), icon: 'bolt', bg: '#fce7f3', color: '#db2777' },
    { label: '刷题正确率', value: questions > 0 ? `${accuracy}%` : '--', icon: 'check', bg: '#f3e8ff', color: '#9333ea' },
  ]

  const sessions = plans
    .flatMap((plan) => (plan.sessions ?? []).map((session) => ({ ...session, plan })))
    .sort((a, b) => (b.endedAt ?? b.startedAt ?? 0) - (a.endedAt ?? a.startedAt ?? 0))
    .slice(0, 8)

  return (
    <>
      <div className="stats-grid">
        {cards.map((card) => (
          <div className="stat-card" key={card.label}>
            <span className="stat-icon" style={{ background: card.bg, color: card.color }}>
              <Icon name={card.icon} size={21} />
            </span>
            <div>
              <div className="stat-value">{card.value}</div>
              <div className="stat-label">{card.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">近 7 天学习时长</h2>
          <span className="small muted">蓝色为专项学习，绿色为刷题</span>
        </div>
        <div className="card-body">
          {weekSeconds === 0 ? (
            <div className="empty-state" style={{ padding: '32px 12px' }}>
              <div className="empty-icon"><Icon name="clock" size={22} /></div>
              <h3>还没有计时记录</h3>
              <p>打开任务点击「开始计时」，这里会显示每天的学习投入</p>
            </div>
          ) : (
            <div className="daily-chart">
              {days.map((day) => {
                const totalDay = day.study + day.practice
                return (
                  <div className="daily-col" key={day.key} title={`${day.key} · ${durationText(totalDay)}`}>
                    <span className="daily-value">{totalDay > 0 ? `${Math.round(totalDay / 60)}m` : ''}</span>
                    <div className="daily-track">
                      <div className="daily-bar study" style={{ height: `${(day.study / chartMax) * 100}%` }} />
                      <div className="daily-bar practice" style={{ height: `${(day.practice / chartMax) * 100}%` }} />
                    </div>
                    <span className="daily-label">{day.label}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="plan-stats-grid">
        <div className="card">
          <div className="card-header"><h2 className="card-title">各模块投入</h2></div>
          <div className="card-body">
            {byModule.map((item) => {
              const color = MODULE_COLORS[item.module]
              return (
                <div className="stat-bar-row" key={item.module}>
                  <span className="stat-bar-label">{item.module}</span>
                  <div className="stat-bar-track">
                    <div className="stat-bar-fill" style={{ width: `${(item.seconds / maxSeconds) * 100}%`, background: color.color }} />
                  </div>
                  <span className="stat-bar-value">{formatClock(item.seconds)}</span>
                  <span className="stat-bar-sub">{item.done}/{item.count}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h2 className="card-title">模式分布</h2></div>
          <div className="card-body">
            {byMode.map((item) => (
              <div className="stat-bar-row" key={item.label}>
                <span className="stat-bar-label mode-label">{item.label}</span>
                <div className="stat-bar-track">
                  <div className="stat-bar-fill" style={{ width: `${(item.seconds / modeMax) * 100}%`, background: item.color }} />
                </div>
                <span className="stat-bar-value">{formatClock(item.seconds)}</span>
              </div>
            ))}
            <div className="stat-divider" />
            <div className="practice-summary">
              <div><span>累计刷题</span><strong>{questions} 题</strong></div>
              <div><span>做对</span><strong>{correct} 题</strong></div>
              <div><span>平均正确率</span><strong>{questions > 0 ? `${accuracy}%` : '--'}</strong></div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">最近计时记录</h2>
          <span className="small muted">最多显示 8 条</span>
        </div>
        <div className="card-body tight">
          {sessions.length === 0 ? (
            <div className="empty-state" style={{ padding: '28px 12px' }}>
              <p>暂无记录，完成一次计时或补录用时后会出现在这里</p>
            </div>
          ) : (
            <div className="session-list">
              {sessions.map((session) => (
                <div className="session-row" key={session.id}>
                  <span className="session-date">{new Date(session.endedAt ?? session.startedAt ?? 0).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="session-title">{session.plan.title}</span>
                  <span className={`chip ${normalizeMode(session.plan.mode) === '刷题' ? 'chip-warning' : 'chip-primary'}`}>{normalizeMode(session.plan.mode)}</span>
                  {session.manual && <span className="chip">补录</span>}
                  <strong className="session-seconds">{formatClock(session.seconds)}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
