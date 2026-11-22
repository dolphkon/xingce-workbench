import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../../components/ui'
import { put } from '../../lib/db'
import {
  ACCURACY_RANGES, isAccuracyRange, isDateRange, matchesAccuracy, matchesDate,
  type AccuracyRange, type DateRange,
} from '../../lib/filters'
import { useCollection } from '../../lib/hooks'
import { dateKey, formatQuestionText } from '../../lib/utils'
import { QUESTION_TYPES, type Mistake, type QuestionType } from '../../types'

interface PracticeResult {
  id: string
  title: string
  chosen: string
  answer: string
  correct: boolean
}

function shuffle<T>(input: T[]): T[] {
  const copy = [...input]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

const normalize = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '')

export default function PracticePage() {
  const [params] = useSearchParams()
  const { items } = useCollection('mistakes')

  const [days, setDays] = useState<DateRange>(() => {
    const value = params.get('days')
    return isDateRange(value) ? value : '7'
  })
  const [type, setType] = useState<QuestionType | '全部'>(() => {
    const value = params.get('type')
    return QUESTION_TYPES.includes(value as QuestionType) ? (value as QuestionType) : '全部'
  })
  const [accuracy, setAccuracy] = useState<AccuracyRange>(() => {
    const value = params.get('accuracy')
    return isAccuracyRange(value) ? value : 'all'
  })
  const [startDate, setStartDate] = useState(() => params.get('start') ?? '')
  const [endDate, setEndDate] = useState(() => params.get('end') ?? '')
  const [limit, setLimit] = useState('20')

  const [started, setStarted] = useState(false)
  const [pool, setPool] = useState<Mistake[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [textAnswer, setTextAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [results, setResults] = useState<PracticeResult[]>([])
  const [finished, setFinished] = useState(false)
  const [saving, setSaving] = useState(false)

  const eligible = useMemo(() => items.filter((item) => {
    if (!matchesDate(item.createdAt, days, startDate, endDate)) return false
    if (type !== '全部' && item.type !== type) return false
    if (!matchesAccuracy(item.accuracy, accuracy)) return false
    return true
  }), [items, days, startDate, endDate, type, accuracy])

  const current = pool[index]
  const lastResult = results[results.length - 1]
  const visibleOptions = current
    ? current.options.map((text, i) => ({ text, letter: String.fromCharCode(65 + i) })).filter((o) => o.text.trim())
    : []

  const start = () => {
    const chosen = shuffle(eligible).slice(0, limit === 'all' ? undefined : Number(limit))
    setPool(chosen)
    setIndex(0)
    setSelected(null)
    setTextAnswer('')
    setSubmitted(false)
    setResults([])
    setFinished(false)
    setStarted(true)
  }

  const confirm = async () => {
    if (!current || saving) return
    const chosen = (selected ?? textAnswer).trim().toUpperCase()
    if (!chosen) return
    const correct = normalize(chosen) === normalize(current.answer)
    setSaving(true)
    try {
      await put('mistakes', {
        ...current,
        reviewCount: current.reviewCount + 1,
        correctCount: current.correctCount + (correct ? 1 : 0),
        lastReviewedAt: Date.now(),
        updatedAt: Date.now(),
      })
      setResults((prev) => [...prev, { id: current.id, title: current.title, chosen, answer: current.answer, correct }])
      setSubmitted(true)
    } finally {
      setSaving(false)
    }
  }

  const next = () => {
    if (index + 1 >= pool.length) {
      setFinished(true)
      return
    }
    setIndex((value) => value + 1)
    setSelected(null)
    setTextAnswer('')
    setSubmitted(false)
  }

  const reset = () => {
    setStarted(false)
    setPool([])
    setResults([])
    setFinished(false)
  }

  if (!started) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1 className="page-title">专项刷题</h1>
            <p className="page-subtitle">针对近段时间的错题集中突破，练习记录会自动回写</p>
          </div>
          <div className="header-actions">
            <Link className="btn" to="/mistakes"><Icon name="back" size={16} /> 返回错题库</Link>
          </div>
        </div>

        <div className="card" style={{ maxWidth: 720 }}>
          <div className="card-header"><h2 className="card-title">选择练习范围</h2></div>
          <div className="card-body">
            <div className="form-field">
              <label className="form-label">录入时间</label>
              <div className="segmented" style={{ alignSelf: 'flex-start' }}>
                {([['7', '近 7 天'], ['30', '近 30 天'], ['all', '全部时间'], ['custom', '自定义']] as [DateRange, string][]).map(([value, label]) => (
                  <button key={value} className={days === value ? 'active' : ''} onClick={() => setDays(value)}>{label}</button>
                ))}
              </div>
            </div>
            {days === 'custom' && (
              <div className="form-field">
                <label className="form-label">日期范围</label>
                <div className="date-range">
                  <input type="date" className="input" value={startDate} max={endDate || dateKey(new Date())} onChange={(e) => setStartDate(e.target.value)} aria-label="开始日期" />
                  <span className="small muted">至</span>
                  <input type="date" className="input" value={endDate} min={startDate} max={dateKey(new Date())} onChange={(e) => setEndDate(e.target.value)} aria-label="结束日期" />
                </div>
              </div>
            )}
            <div className="form-row">
              <div className="form-field">
                <label className="form-label">题型</label>
                <select className="select" value={type} onChange={(e) => setType(e.target.value as QuestionType | '全部')}>
                  <option value="全部">全部题型</option>
                  {QUESTION_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">正确率范围</label>
                <select className="select" value={accuracy} onChange={(e) => setAccuracy(e.target.value as AccuracyRange)}>
                  <option value="all">全部正确率</option>
                  {ACCURACY_RANGES.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">本轮题量</label>
                <select className="select" value={limit} onChange={(e) => setLimit(e.target.value)}>
                  <option value="10">10 题</option>
                  <option value="20">20 题</option>
                  <option value="50">50 题</option>
                  <option value="all">全部</option>
                </select>
              </div>
            </div>
            <div className="divider" />
            <p className="small muted">符合条件的错题：<strong style={{ color: 'var(--primary)' }}>{eligible.length}</strong> 道</p>
            {eligible.length === 0 ? (
              <p className="notice">当前范围内没有错题，试试放宽时间、题型或正确率条件。</p>
            ) : null}
            <div className="form-actions">
              <button className="btn btn-primary" onClick={start} disabled={eligible.length === 0}>
                <Icon name="play" size={16} /> 开始练习
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  if (finished) {
    const correctCount = results.filter((r) => r.correct).length
    const rate = results.length ? Math.round((correctCount / results.length) * 100) : 0
    return (
      <>
        <div className="page-header">
          <div><h1 className="page-title">练习完成</h1><p className="page-subtitle">本轮共练习 {results.length} 道错题</p></div>
          <div className="header-actions">
            <button className="btn" onClick={reset}><Icon name="refresh" size={16} /> 再练一轮</button>
            <Link className="btn btn-primary" to="/mistakes">返回错题库</Link>
          </div>
        </div>
        <div className="card">
          <div className="card-body">
            <div className="result-hero">
              <div className="result-score" style={{ color: rate >= 80 ? 'var(--success)' : rate >= 60 ? 'var(--warning)' : 'var(--danger)' }}>
                {rate}%
              </div>
              <div className="result-label">正确率 · 答对 {correctCount} / {results.length}</div>
            </div>
            <div className="divider" />
            <div className="list" style={{ margin: '0 -20px -20px' }}>
              {results.map((result, i) => (
                <div className="list-item" key={result.id}>
                  <span className={`chip ${result.correct ? 'chip-success' : 'chip-danger'}`} style={{ minWidth: 42, justifyContent: 'center' }}>
                    {result.correct ? '正确' : '错误'}
                  </span>
                  <div className="list-item-main">
                    <Link className="item-title" to={`/mistakes/${result.id}`} style={{ display: 'block' }}>
                      {i + 1}. {result.title}
                    </Link>
                    <div className="item-meta">
                      <span className="small muted">你的答案：{result.chosen}</span>
                      {!result.correct && <span className="small" style={{ color: 'var(--success)' }}>正确答案：{result.answer}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    )
  }

  if (!current) {
    return <EmptyPractice onReset={reset} />
  }

  return (
    <>
      <div className="practice-head">
        <div>
          <Link to="/mistakes" className="small light" onClick={() => setStarted(false)}>退出练习</Link>
          <div className="practice-counter" style={{ marginTop: 4 }}>
            第 {index + 1} / {pool.length} 题 · {current.type}
          </div>
        </div>
        <div className="row">
          <span className="chip chip-success">累计答对 {results.filter((r) => r.correct).length}</span>
          <span className="chip chip-danger">答错 {results.filter((r) => !r.correct).length}</span>
        </div>
      </div>
      <div className="practice-progress"><div style={{ width: `${((index + (submitted ? 1 : 0)) / pool.length) * 100}%` }} /></div>

      <div className="card">
        <div className="card-body">
          <div className="question-text" style={{ fontSize: 15 }}>{formatQuestionText(current.title)}</div>
          {current.source && (
            <div className="small muted" style={{ marginTop: 6 }}>来源：{current.source}</div>
          )}

          {current.images.length > 0 && (
            <div className="image-grid" style={{ marginTop: 16 }}>
              {current.images.map((image, i) => (
                <img key={`${image.slice(0, 40)}-${i}`} src={image} alt={`题目图片 ${i + 1}`} style={{ width: '100%', height: 170, objectFit: 'cover', border: '1px solid var(--border)', borderRadius: 8 }} />
              ))}
            </div>
          )}

          {visibleOptions.length > 0 ? (
            <div className="option-list">
              {visibleOptions.map((option) => {
                const isCorrect = submitted && option.letter === current.answer
                const isWrong = submitted && selected === option.letter && option.letter !== current.answer
                const isSelected = !submitted && selected === option.letter
                return (
                  <button
                    key={option.letter}
                    className={`option-item${isCorrect ? ' correct' : ''}${isWrong ? ' wrong' : ''}${isSelected ? ' selected' : ''}`}
                    disabled={submitted}
                    onClick={() => setSelected(option.letter)}
                  >
                    <span className="option-key">{option.letter}</span>
                    <span>{option.text}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="form-field" style={{ marginTop: 16 }}>
              <label className="form-label">输入你的答案</label>
              <input className="input" value={textAnswer} onChange={(e) => setTextAnswer(e.target.value)} disabled={submitted} placeholder="输入答案后确认" />
            </div>
          )}

          {submitted && lastResult && (
            <>
              <div className="divider" />
              <div className="row" style={{ marginBottom: 10 }}>
                <span className={`chip ${lastResult.correct ? 'chip-success' : 'chip-danger'}`}>
                  {lastResult.correct ? '回答正确' : '回答错误'}
                </span>
                <span className="small muted">正确答案：{current.answer}</span>
              </div>
              <div className="form-label">解析 / 复盘</div>
              <div className="analysis-block">{current.analysis || '暂无解析'}</div>
            </>
          )}

          <div className="divider" />
          <div className="row">
            <span className="small light">{current.tags.map((tag) => `#${tag}`).join('  ')}</span>
            <span className="spacer" />
            {!submitted ? (
              <button className="btn btn-primary" onClick={() => void confirm()} disabled={saving || !(selected ?? textAnswer).trim()}>
                <Icon name="check" size={16} /> {saving ? '提交中…' : '确认答案'}
              </button>
            ) : (
              <button className="btn btn-primary" onClick={next}>
                {index + 1 >= pool.length ? '查看结果' : '下一题'} <Icon name="chevron" size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function EmptyPractice({ onReset }: { onReset: () => void }) {
  return (
    <div className="card">
      <div className="empty-state">
        <div className="empty-icon"><Icon name="target" size={24} /></div>
        <h3>本轮没有题目</h3>
        <p>请返回重新选择练习范围</p>
        <button className="btn btn-primary" onClick={onReset}>重新选择</button>
      </div>
    </div>
  )
}
