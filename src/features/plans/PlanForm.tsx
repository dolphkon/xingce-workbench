import { useRef, useState } from 'react'
import { Icon } from '../../components/ui'
import { cachePlan, mirrorPlan, normalizeMode } from '../../lib/plans'
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

const MOCK_TEMPLATE: PlanSubTask[] = [
  { id: 'mock-1', type: '言语理解', count: 30, correct: 0 },
  { id: 'mock-2', type: '判断推理', count: 30, correct: 0 },
  { id: 'mock-3', type: '资料分析', count: 20, correct: 0 },
  { id: 'mock-4', type: '数量关系', count: 15, correct: 0 },
  { id: 'mock-5', type: '常识判断', count: 20, correct: 0 },
]

const SOURCE_PRESETS = ['网课', '教材', '自学', '真题']
const MINUTE_PRESETS = [25, 45, 60, 90]

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const openPicker = () => {
    const input = ref.current as (HTMLInputElement & { showPicker?: () => void }) | null
    try {
      input?.showPicker?.()
    } catch {
      input?.focus()
    }
  }
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <div className="time-field" onClick={openPicker}>
        <input
          ref={ref}
          className="input"
          type="time"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="可选"
        />
        {value && (
          <button
            type="button"
            className="time-clear"
            onClick={(event) => { event.stopPropagation(); onChange('') }}
          >
            清除
          </button>
        )}
      </div>
    </div>
  )
}

export default function PlanForm({ initial, defaultDate, onSaved, onCancel }: Props) {
  const [module, setModule] = useState<StudyModule>(initial?.module ?? '言语')
  const [mode, setMode] = useState<PlanMode>(normalizeMode(initial?.mode ?? '学习'))
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [subTasks, setSubTasks] = useState<PlanSubTask[]>(() => (initial?.subTasks ?? []).map((task) => ({ ...task, id: task.id || uid() })))
  const [date, setDate] = useState(initial?.date ?? defaultDate)
  const [startTime, setStartTime] = useState(initial?.startTime ?? '')
  const [endTime, setEndTime] = useState(initial?.endTime ?? '')
  const [priority, setPriority] = useState<PlanPriority>(initial?.priority ?? '重要不紧急')
  const [source, setSource] = useState(initial?.source ?? '')
  const [targetMinutes, setTargetMinutes] = useState(String(initial?.targetMinutes ?? 45))
  const [questionCount, setQuestionCount] = useState(String(initial?.questionCount ?? ''))
  const [correctCount, setCorrectCount] = useState(String(initial?.correctCount ?? ''))
  const [error, setError] = useState<string | null>(null)

  const isPractice = mode === '刷题'
  const plannedQuestions = subTasks.reduce((sum, task) => sum + (Number(task.count) || 0), 0)
  const totalQuestions = Number(questionCount) || plannedQuestions
  const totalCorrect = Number(correctCount) || subTasks.reduce((sum, task) => sum + (Number(task.correct) || 0), 0)
  const accuracy = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0

  const handleSubmit = () => {
    if (!title.trim()) {
      setError('请填写任务标题')
      return
    }
    if (isPractice && Number(correctCount) > Number(questionCount) && Number(questionCount) > 0) {
      setError('做对题数不能大于总题量')
      return
    }
    setError(null)
    const now = Date.now()
    const record: StudyPlan = {
      id: initial?.id ?? uid(),
      module,
      mode: normalizeMode(mode),
      title: title.trim().slice(0, 50),
      description: description.trim().slice(0, 200),
      subTasks: subTasks
        .filter((task) => task.type.trim())
        .map((task) => ({
          ...task,
          id: task.id || uid(),
          type: task.type.trim(),
          count: Math.max(0, Number(task.count) || 0),
          correct: isPractice ? Math.max(0, Number(task.correct) || 0) : undefined,
        })),
      date,
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      priority,
      completed: initial?.completed ?? false,
      elapsedSeconds: initial?.elapsedSeconds ?? 0,
      timerStartedAt: initial?.timerStartedAt,
      sessions: initial?.sessions ?? [],
      activeSubTaskId: initial?.activeSubTaskId,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    }
    if (isPractice) {
      record.questionCount = totalQuestions || undefined
      record.correctCount = totalCorrect || undefined
    } else {
      record.source = source.trim().slice(0, 60) || undefined
      record.targetMinutes = Math.max(0, Number(targetMinutes) || 45)
    }
    // 立即写入本地缓存，关闭弹窗；数据库镜像在后台进行
    cachePlan(record)
    void mirrorPlan(record)
    onSaved()
  }

  const updateSubTask = (index: number, patch: Partial<PlanSubTask>) => {
    setSubTasks((prev) => prev.map((task, i) => (i === index ? { ...task, ...patch } : task)))
  }

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="form-field">
        <label className="form-label">任务模式</label>
        <div className="segmented mode-segmented">
          {PLAN_MODES.map((item) => (
            <button
              key={item}
              className={mode === item ? 'active' : ''}
              onClick={() => setMode(item)}
              type="button"
            >
              {item === '学习' ? '专项学习' : '刷题'}
            </button>
          ))}
        </div>
        <span className="form-hint mode-hint">
          {isPractice
            ? '适合真题、模块练习与模考：记录题量和正确率，计时自动统计。'
            : '适合理论网课、教材学习与自主复盘：记录课程来源、预计时长，用计时器追踪投入。'}
        </span>
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
          onChange={(event) => setTitle(event.target.value.slice(0, 50))}
          placeholder={isPractice ? '如：资料分析限时刷题' : '如：花生十三判断推理网课'}
        />
        <span className="form-hint" style={{ textAlign: 'right' }}>{title.length}/50</span>
      </div>

      <div className="form-field">
        <label className="form-label">任务描述（可选）</label>
        <textarea
          className="textarea"
          value={description}
          onChange={(event) => setDescription(event.target.value.slice(0, 200))}
          placeholder={isPractice ? '记录本次练习的目标、注意事项…' : '记录要听的课时、要复盘的知识点…'}
          style={{ minHeight: 70 }}
        />
        <span className="form-hint" style={{ textAlign: 'right' }}>{description.length}/200</span>
      </div>

      {isPractice ? (
        <div className="form-field">
          <label className="form-label">练习结果</label>
          <div className="form-row practice-result-row">
            <div className="form-field">
              <label className="form-label">总题量</label>
              <input className="input" type="number" min={0} value={questionCount} onChange={(event) => setQuestionCount(event.target.value)} placeholder="留空则按题型汇总" />
            </div>
            <div className="form-field">
              <label className="form-label">做对题数</label>
              <input className="input" type="number" min={0} value={correctCount} onChange={(event) => setCorrectCount(event.target.value)} placeholder="可稍后补录" />
            </div>
          </div>
          <div className="accuracy-preview">
            <span>本次正确率</span>
            <strong>{totalQuestions > 0 ? `${accuracy}%` : '--'}</strong>
            <span className="small muted">{totalQuestions > 0 ? `${totalCorrect} / ${totalQuestions} 题` : '填写题量后自动计算'}</span>
          </div>
        </div>
      ) : (
        <div className="form-field">
          <label className="form-label">学习来源</label>
          <input className="input" value={source} onChange={(event) => setSource(event.target.value)} placeholder="如：粉笔 APP / 教材 / 自主整理" />
          <div className="quick-chips">
            {SOURCE_PRESETS.map((preset) => (
              <button key={preset} type="button" className={`quick-chip${source === preset ? ' active' : ''}`} onClick={() => setSource(preset)}>{preset}</button>
            ))}
          </div>
        </div>
      )}

      <div className="form-field">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <label className="form-label" style={{ margin: 0 }}>{isPractice ? '题型拆解' : '章节拆解'}</label>
          {isPractice && (
            <button className="btn btn-sm" type="button" onClick={() => setSubTasks(MOCK_TEMPLATE.map((task) => ({ ...task, id: uid() })))}>
              <Icon name="list" size={13} /> 模考模板
            </button>
          )}
        </div>
        <div className="subtask-table">
          <div className={`subtask-head${isPractice ? ' practice' : ''}`}>
            <span>{isPractice ? '题型' : '章节 / 知识点'}</span>
            <span>{isPractice ? '题量' : '预计分钟'}</span>
            {isPractice && <span>做对</span>}
            <span />
          </div>
          {subTasks.length === 0 ? (
            <div className="subtask-empty">暂无拆解，点击下方添加{isPractice ? '或使用模考模板' : '章节'}</div>
          ) : subTasks.map((task, index) => (
            <div className={`subtask-row${isPractice ? ' practice' : ''}`} key={task.id}>
              <input
                className="input"
                value={task.type}
                onChange={(event) => updateSubTask(index, { type: event.target.value })}
                placeholder={isPractice ? '如：资料分析' : '如：第三章 削弱论证'}
              />
              <input
                className="input"
                type="number"
                min={0}
                value={task.count || ''}
                onChange={(event) => updateSubTask(index, { count: Number(event.target.value) })}
                placeholder={isPractice ? '题量' : '分钟'}
              />
              {isPractice && (
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={task.correct ?? ''}
                  onChange={(event) => updateSubTask(index, { correct: Number(event.target.value) })}
                  placeholder="做对"
                />
              )}
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
          <button
            className="btn btn-sm btn-block"
            type="button"
            onClick={() => setSubTasks((prev) => [...prev, { id: uid(), type: '', count: 0, correct: 0 }])}
          >
            <Icon name="plus" size={13} /> 添加一行
          </button>
        </div>
      </div>

      {!isPractice && (
        <div className="form-field">
          <label className="form-label">预计时长（分钟）</label>
          <input className="input" type="number" min={0} value={targetMinutes} onChange={(event) => setTargetMinutes(event.target.value)} />
          <div className="quick-chips">
            {MINUTE_PRESETS.map((preset) => (
              <button key={preset} type="button" className={`quick-chip${Number(targetMinutes) === preset ? ' active' : ''}`} onClick={() => setTargetMinutes(String(preset))}>{preset} 分钟</button>
            ))}
          </div>
        </div>
      )}

      <div className="form-row">
        <div className="form-field">
          <label className="form-label">计划日期</label>
          <input className="input" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="form-field">
          <label className="form-label">优先级</label>
          <select className="select" value={priority} onChange={(event) => setPriority(event.target.value as PlanPriority)}>
            {PLAN_PRIORITIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
      </div>

      <div className="form-row">
        <TimeField label="开始时间（可选）" value={startTime} onChange={setStartTime} />
        <TimeField label="结束时间（可选）" value={endTime} onChange={setEndTime} />
      </div>

      <div className="form-actions">
        <button className="btn" type="button" onClick={onCancel}>取消</button>
        <button className="btn btn-primary" type="button" onClick={handleSubmit}>
          <Icon name="save" size={16} /> {initial ? '保存修改' : '创建计划'}
        </button>
      </div>
    </>
  )
}
