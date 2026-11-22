import { Icon } from '../../components/ui'
import { formatHours } from '../../lib/utils'
import { STUDY_MODULES, type StudyPlan } from '../../types'
import { MODULE_COLORS } from './PlanForm'

function totalSeconds(plans: StudyPlan[]): number {
  return plans.reduce((sum, plan) => sum + plan.elapsedSeconds, 0)
}

export default function PlanStats({ plans }: { plans: StudyPlan[] }) {
  const total = plans.length
  const completed = plans.filter((plan) => plan.completed).length
  const seconds = totalSeconds(plans)
  const rate = total ? Math.round((completed / total) * 100) : 0

  const byModule = STUDY_MODULES.map((module) => {
    const list = plans.filter((plan) => plan.module === module)
    return {
      module,
      count: list.length,
      done: list.filter((plan) => plan.completed).length,
      seconds: totalSeconds(list),
    }
  })
  const maxSeconds = Math.max(1, ...byModule.map((item) => item.seconds))

  const byMode = [
    { label: '专注', seconds: totalSeconds(plans.filter((plan) => plan.mode === '专注')) },
    { label: '刷题', seconds: totalSeconds(plans.filter((plan) => plan.mode === '刷题')) },
  ]
  const modeMax = Math.max(1, ...byMode.map((item) => item.seconds))

  const cards = [
    { label: '计划总数', value: String(total), icon: 'calendar', bg: '#eef2ff', color: '#4f46e5' },
    { label: '已完成', value: String(completed), icon: 'check', bg: '#dcfce7', color: '#16a34a' },
    { label: '完成率', value: `${rate}%`, icon: 'target', bg: '#fef3c7', color: '#d97706' },
    { label: '累计学习', value: formatHours(seconds), icon: 'clock', bg: '#e0f2fe', color: '#0284c7' },
  ]

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
          <h2 className="card-title">各模块学习时长</h2>
          <span className="small muted">按累计计时统计</span>
        </div>
        <div className="card-body">
          {byModule.map((item) => {
            const color = MODULE_COLORS[item.module]
            return (
              <div className="stat-bar-row" key={item.module}>
                <span className="stat-bar-label">{item.module}</span>
                <div className="stat-bar-track">
                  <div className="stat-bar-fill" style={{ width: `${(item.seconds / maxSeconds) * 100}%`, background: color.color }} />
                </div>
                <span className="stat-bar-value">{formatHours(item.seconds)}</span>
                <span className="stat-bar-sub">{item.done}/{item.count}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 className="card-title">学习模式分布</h2></div>
        <div className="card-body">
          {byMode.map((item) => (
            <div className="stat-bar-row" key={item.label}>
              <span className="stat-bar-label">{item.label}</span>
              <div className="stat-bar-track">
                <div
                  className="stat-bar-fill"
                  style={{ width: `${(item.seconds / modeMax) * 100}%`, background: item.label === '专注' ? '#4f46e5' : '#16a34a' }}
                />
              </div>
              <span className="stat-bar-value">{formatHours(item.seconds)}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
