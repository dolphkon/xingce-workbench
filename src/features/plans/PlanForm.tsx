import { useState } from 'react'
import { Icon } from '../../components/ui'
import { put } from '../../lib/db'
import { uid } from '../../lib/utils'
import {
  PLAN_MODES,
  PLAN_PRIORITIES,
  STUDY_MODULES,
  type PlanMode,
  type PlanPriority,
  type PlanSubTask,
  type StudyModule,
  type StudyPlan,
} from '../../types'

interface Props {
  initial?: StudyPlan
  defaultDate: string
  onSaved: () => void
  onCancel: () => void
}

export const MODULE_COLORS: Record<StudyModule, { bg: string; color: string }> = {
  言语: { bg: '#eef2ff', color: '#4f46e5' },
  判断: { bg: '#dcfce7', color: '#16a34a' },
  资料: { bg: '#e0f2fe', color: '#0284c7' },
  图推: { bg: '#fef3c7', color: '#d97706' },
  数量: { bg: '#fce7f3', color: '#db2777' },
  时政: { bg: '#fee2e2', color: '#dc2626' },
  常识: { bg: '#f3e8ff', color: '#9333ea' },
}

const MOCK_TEMPLATE: { type: string; count: number }[] = [
  { type: '言语理解', count: 30 },
  { type: '判断推理', count: 30 },
  { type: '资料分析', count: 20 },
  { type: '数量关系', count: 15 },
  { type: '常识判断', count: 20 },
]

export default function PlanForm({ initial, defaultDate, onSaved, onCancel }: Props) {
  const [module, setModule] = useState<StudyModule>(initial?.module ?? '言语')
  const [mode, setMode] = useState<PlanMode>(initial?.mode ?? '专注')
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [subTasks, setSubTasks] = useState<PlanSubTask[]>(initial?.subTasks ?? [])
  const [date, setDate] = useState(initial?.date ?? defaultDate)
  const [startTime, setStartTime] = useState(initial?.startTime ?? '')
  const [endTime, setEndTime] = useState(initial?.endTime ?? '')
  const [priority, setPriority] = useState<PlanPriority>(initial?.priority ?? '重要不紧急')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!title.trim()) {
      setError('请填写任务标题')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const now = Date.now()
      const record: StudyPlan = {
        id: initial?.id ?? uid(),
        module,
        mode,
        title: title.trim().slice(0, 50),
        description: description.trim().slice(0, 200),
        subTasks: subTasks
          .filter((task) => task.type.trim())
          .map((task) => ({ ...task, type: task.type.trim(), count: Math.max(0, Number(task.count) || 0) })),
        date,
        startTime: startTime || undefined,
        endTime: endTime || undefined,
        priority,
        completed: initial?.completed ?? false,
        elapsedSeconds: initial?.elapsedSeconds ?? 0,
        timerStartedAt: initial?.timerStartedAt,
        createdAt: initial?.createdAt ?? now,
        updatedAt: now,
      }
      await put('plans', record)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
      setSaving(false)
    }
  }

  const updateSubTask = (index: number, patch: Partial<PlanSubTask>) => {
    setSubTasks((prev) => prev.map((task, i) => (i === index ? { ...task, ...patch } : task)))
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="form-field">
        <label className="form-label">任务模式</label>
        <div className="segmented">
          {PLAN_MODES.map((item) => (
            <button
              key={item}
              className={mode === item ? 'active' : ''}
              onClick={() => setMode(item)}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">任务模块</label>
        <div className="module-picker">
          {STUDY_MODULES.map((item) => {
            const color = MODULE_COLORS[item]
            return (
              <button
                key={item}
                type="button"
                className={`module-option${module === item ? ' active' : ''}`}
                style={module === item ? { background: color.bg, color: color.color, borderColor: color.color } : undefined}
                onClick={() => setModule(item)}
              >
                <span className="module-option-icon" style={module !== item ? { background: color.bg, color: color.color } : undefined}>
                  {item.slice(0, 1)}
                </span>
                <span>{item}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="form-field">
        <label className="form-label">任务标题 <span className="req">*</span></label>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 50))}
          placeholder="如：资料分析专项练习"
        />
        <span className="form-hint" style={{ textAlign: 'right' }}>{title.length}/50</span>
      </div>

      <div className="form-field">
        <label className="form-label">任务描述（可选）</label>
        <textarea
          className="textarea"
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 200))}
          placeholder="输入任务描述…"
          style={{ minHeight: 80 }}
        />
        <span className="form-hint" style={{ textAlign: 'right' }}>{description.length}/200</span>
      </div>

      <div className="form-field">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <label className="form-label" style={{ margin: 0 }}>任务拆解</label>
          <button className="btn btn-sm" type="button" onClick={() => setSubTasks(MOCK_TEMPLATE.map((item) => ({ ...item, id: uid() })))}>
            <Icon name="list" size={13} /> 模考模板
          </button>
        </div>
        <div className="subtask-table">
          <div className="subtask-head">
            <span>题型</span><span>数量</span><span />
          </div>
          {subTasks.length === 0 ? (
            <div className="subtask-empty">暂无拆解，点击下方添加或使用模考模板</div>
          ) : subTasks.map((task, index) => (
            <div className="subtask-row" key={task.id}>
              <input
                className="input"
                value={task.type}
                onChange={(e) => updateSubTask(index, { type: e.target.value })}
                placeholder="如：资料分析"
              />
              <input
                className="input"
                type="number"
                min={0}
                value={task.count || ''}
                onChange={(e) => updateSubTask(index, { count: Number(e.target.value) })}
                placeholder="题量"
              />
              <button
                className="icon-btn danger"
                type="button"
                onClick={() => setSubTasks((prev) => prev.filter((_, i) => i !== index))}
                aria-label="删除该行"
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          <button className="btn btn-sm btn-block" type="button" onClick={() => setSubTasks((prev) => [...prev, { id: uid(), type: '', count: 0 }])}>
            <Icon name="plus" size={13} /> 添加一行
          </button>
        </div>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">计划日期</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="form-label">优先级</label>
          <select className="select" value={priority} onChange={(e) => setPriority(e.target.value as PlanPriority)}>
            {PLAN_PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">开始时间（可选）</label>
          <input className="input" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
        </div>
        <div className="form-field">
          <label className="form-label">结束时间（可选）</label>
          <input className="input" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
        </div>
      </div>

      <div className="form-actions">
        <button className="btn" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" onClick={() => void handleSubmit()} disabled={saving}>
          <Icon name="save" size={16} /> {saving ? '保存中…' : initial ? '保存修改' : '创建计划'}
        </button>
      </div>
    </>
  )
}
