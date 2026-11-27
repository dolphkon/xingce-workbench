import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ConfirmDialog, Icon } from '../../components/ui'
import QuestionStem from '../../components/QuestionStem'
import QuestionSketch from './QuestionSketch'
import { put } from '../../lib/db'
import {
  ACCURACY_RANGES, isAccuracyRange, isDateRange, matchesAccuracy, matchesDate,
  type AccuracyRange, type DateRange,
} from '../../lib/filters'
import { FONT_SIZES, readFontIndex, setFontIndex } from '../../lib/fontSize'
import { THEME_CHANGE_EVENT, readTheme, setTheme, type ThemeKey } from '../../lib/theme'
import { useCollection } from '../../lib/hooks'
import { readCategories } from '../../lib/categories'
import { dateKey, formatClock, formatQuestionText } from '../../lib/utils'
import { reviewStatusOf, type Mistake, type QuestionType } from '../../types'

interface PracticeResult {
  id: string
  title: string
  chosen: string
  answer: string
  correct: boolean
  marked: boolean
  note: string
}

interface PracticeSession {
  ids: string[]
  answers: Record<string, string>
  textAnswers: Record<string, string>
  marks: Record<string, boolean>
  bookmarks: Record<string, boolean>
  notes: Record<string, string>
  elapsed: number
  savedAt: number
}

const SESSION_KEY = 'xingce-practice-session-v1'

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
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { items } = useCollection('mistakes')
  const [categories] = useState(readCategories)

  const [days, setDays] = useState<DateRange>(() => {
    const value = params.get('days')
    return isDateRange(value) ? value : '7'
  })
  const [type, setType] = useState<QuestionType | '全部'>(() => params.get('type') || '全部')
  const [subType, setSubType] = useState(() => params.get('subType') || '全部')
  const [accuracy, setAccuracy] = useState<AccuracyRange>(() => {
    const value = params.get('accuracy')
    return isAccuracyRange(value) ? value : 'all'
  })
  const [startDate, setStartDate] = useState(() => params.get('start') ?? '')
  const [endDate, setEndDate] = useState(() => params.get('end') ?? '')
  const [limit, setLimit] = useState('20')

  const [started, setStarted] = useState(false)
  const [pool, setPool] = useState<Mistake[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({})
  const [marks, setMarks] = useState<Record<string, boolean>>({})
  const [bookmarks, setBookmarks] = useState<Record<string, boolean>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [activeIndex, setActiveIndex] = useState(0)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [theme, setThemeState] = useState(readTheme)
  const dark = theme === 'dark'
  const [fontIndex, setFontIndexState] = useState(readFontIndex)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [results, setResults] = useState<PracticeResult[]>([])
  const [saving, setSaving] = useState(false)
  const [sketchId, setSketchId] = useState<string | null>(null)
  const [sketchEditing, setSketchEditing] = useState(false)
  const restoredRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const eligible = useMemo(() => items.filter((item) => {
    if (reviewStatusOf(item) === 'mastered') return false
    if (!matchesDate(item.createdAt, days, startDate, endDate)) return false
    if (type !== '全部' && item.type !== type) return false
    if (subType !== '全部' && item.subType !== subType) return false
    if (!matchesAccuracy(item.accuracy, accuracy)) return false
    return true
  }), [items, days, startDate, endDate, type, subType, accuracy])

  const answerFor = (item: Mistake) => (answers[item.id] ?? textAnswers[item.id] ?? '').trim()
  const answeredCount = pool.filter((item) => Boolean(answerFor(item))).length
  const markedCount = pool.filter((item) => marks[item.id]).length

  useEffect(() => {
    const onTheme = (event: Event) => setThemeState((event as CustomEvent<ThemeKey>).detail)
    window.addEventListener(THEME_CHANGE_EVENT, onTheme)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
  }, [])

  // 刷新页面后恢复本轮答题进度（同一标签页有效）
  useEffect(() => {
    if (restoredRef.current || started || !items.length) return
    const raw = window.sessionStorage.getItem(SESSION_KEY)
    if (!raw) return
    restoredRef.current = true
    try {
      const session = JSON.parse(raw) as PracticeSession
      const chosen = (session.ids ?? [])
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is Mistake => Boolean(item))
      if (!chosen.length) {
        window.sessionStorage.removeItem(SESSION_KEY)
        return
      }
      setPool(chosen)
      setAnswers(session.answers ?? {})
      setTextAnswers(session.textAnswers ?? {})
      setMarks(session.marks ?? {})
      setBookmarks(session.bookmarks ?? {})
      setNotes(session.notes ?? {})
      setElapsed(session.elapsed ?? 0)
      setStarted(true)
    } catch {
      window.sessionStorage.removeItem(SESSION_KEY)
    }
  }, [items, started])

  useEffect(() => {
    if (!started || reportOpen || !pool.length) return
    const session: PracticeSession = {
      ids: pool.map((item) => item.id),
      answers,
      textAnswers,
      marks,
      bookmarks,
      notes,
      elapsed,
      savedAt: Date.now(),
    }
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  }, [started, reportOpen, pool, answers, textAnswers, marks, bookmarks, notes, elapsed])

  useEffect(() => {
    if (!started || paused || reportOpen) return
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [started, paused, reportOpen])

  useEffect(() => {
    if (!started || reportOpen) return
    const container = scrollRef.current
    if (!container) return
    const onScroll = () => {
      let best = 0
      let bestDistance = Infinity
      pool.forEach((_, index) => {
        const el = document.getElementById(`practice-q-${index}`)
        if (!el) return
        const distance = Math.abs(el.getBoundingClientRect().top - container.getBoundingClientRect().top - 24)
        if (distance < bestDistance) {
          bestDistance = distance
          best = index
        }
      })
      setActiveIndex(best)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => container.removeEventListener('scroll', onScroll)
  }, [started, reportOpen, pool])

  const start = () => {
    const chosen = shuffle(eligible).slice(0, limit === 'all' ? undefined : Number(limit))
    window.sessionStorage.removeItem(SESSION_KEY)
    setPool(chosen)
    setAnswers({})
    setTextAnswers({})
    setMarks({})
    setBookmarks({})
    setNotes({})
    setActiveIndex(0)
    setSheetOpen(false)
    setElapsed(0)
    setPaused(false)
    setSettingsOpen(false)
    setResults([])
    setReportOpen(false)
    setSketchId(null)
    setSketchEditing(false)
    setStarted(true)
  }

  const choose = (item: Mistake, letter: string) => {
    setAnswers((prev) => ({ ...prev, [item.id]: letter }))
  }

  const jumpTo = (index: number) => {
    setActiveIndex(index)
    setSheetOpen(false)
    window.requestAnimationFrame(() => {
      const target = document.getElementById(reportOpen ? `pr-q-${index}` : `practice-q-${index}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const toggleMark = (item: Mistake) => {
    setMarks((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
  }

  const toggleBookmark = (item: Mistake) => {
    setBookmarks((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
  }

  const exit = () => {
    window.sessionStorage.removeItem(SESSION_KEY)
    setConfirmExit(false)
    setStarted(false)
    setPool([])
    setReportOpen(false)
    setSketchId(null)
    setSketchEditing(false)
    navigate('/mistakes')
  }

  const submitExam = async () => {
    setConfirmSubmit(false)
    if (saving) return
    setSaving(true)
    try {
      const now = Date.now()
      const answered = pool.filter((item) => Boolean(answerFor(item)))
      await Promise.all(answered.map((item) => {
        const chosen = answerFor(item).toUpperCase()
        const correct = normalize(chosen) === normalize(item.answer)
        return put('mistakes', {
          ...item,
          reviewCount: item.reviewCount + 1,
          correctCount: item.correctCount + (correct ? 1 : 0),
          lastReviewedAt: now,
          updatedAt: now,
        })
      }))
      setResults(pool.map((item) => {
        const chosen = answerFor(item).toUpperCase()
        return {
          id: item.id,
          title: item.title,
          chosen,
          answer: item.answer,
          correct: Boolean(chosen) && normalize(chosen) === normalize(item.answer),
          marked: Boolean(marks[item.id]),
          note: notes[item.id] ?? '',
        }
      }))
      setReportOpen(true)
      setPaused(true)
      setSheetOpen(false)
      window.sessionStorage.removeItem(SESSION_KEY)
    } finally {
      setSaving(false)
    }
  }

  const download = () => {
    const correctCount = results.filter((result) => result.correct).length
    const rate = results.length ? Math.round((correctCount / results.length) * 100) : 0
    const lines = [
      '# 专项智能练习报告',
      '',
      `- 练习范围：${type === '全部' ? '全部模块' : type}${subType !== '全部' ? ` / ${subType}` : ''}`,
      `- 题量：${pool.length} 题`,
      `- 用时：${formatClock(elapsed)}`,
      reportOpen ? `- 正确率：${rate}%（答对 ${correctCount} / ${results.length}）` : `- 已作答：${answeredCount} 题`,
      `- 标记题：${markedCount} 题`,
      `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
      '',
      '## 题目与作答',
      '',
    ]
    pool.forEach((item, index) => {
      const chosen = answerFor(item).toUpperCase() || '未作答'
      const result = results[index]
      lines.push(`### ${index + 1}. ${formatQuestionText(item.title)}`, '')
      lines.push(`- 题型：${item.subType || item.type}${item.point ? ` / ${item.point}` : ''}`)
      if (marks[item.id]) lines.push('- 标记：是')
      if (bookmarks[item.id]) lines.push('- 收藏：是')
      if (notes[item.id]) lines.push(`- 笔记：${notes[item.id]}`)
      lines.push('')
      item.options.map((text, i) => ({ text, letter: String.fromCharCode(65 + i) }))
        .filter((option) => option.text.trim())
        .forEach((option) => lines.push(`${option.letter}. ${option.text}`))
      item.images.forEach((image, i) => lines.push(`![题目图片 ${i + 1}](${image})`))
      lines.push('', `- 你的答案：${chosen}`)
      if (result) {
        lines.push(`- 正确答案：${result.answer || '—'}`)
        lines.push(`- 结果：${result.correct ? '正确' : result.chosen ? '错误' : '未作答'}`)
        if (item.analysis) lines.push('', '**解析**', '', item.analysis)
      }
      lines.push('', '---', '')
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `专项智能练习-${dateKey(new Date())}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const visibleOptions = (item: Mistake) => item.options
    .map((text, i) => ({ text, letter: String.fromCharCode(65 + i) }))
    .filter((option) => option.text.trim())

  if (!started) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1 className="page-title">专项刷题</h1>
            <p className="page-subtitle">像粉笔一样答题：答题卡、标记、暂停计时、交卷后统一查看结果</p>
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
                <label className="form-label">考试模块</label>
                <select className="select" value={type} onChange={(e) => { setType(e.target.value as QuestionType | '全部'); setSubType('全部') }}>
                  <option value="全部">全部模块</option>
                  {categories.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}
                </select>
              </div>
              <div className="form-field">
                <label className="form-label">题型</label>
                <select className="select" value={subType} onChange={(e) => setSubType(e.target.value)}>
                  <option value="全部">全部题型</option>
                  {Array.from(new Set([
                    ...(type === '全部' ? categories.flatMap((c) => c.types) : (categories.find((c) => c.name === type)?.types ?? [])),
                    ...items.filter((i) => type === '全部' || i.type === type).map((i) => i.subType ?? '').filter(Boolean),
                  ])).map((t) => <option key={t} value={t}>{t}</option>)}
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
            <div className="notice">
              答题时不即时显示对错，交卷后统一出成绩；底部答题卡可随时跳题、查看标记与未答题。
            </div>
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

  const examClass = `practice-exam${dark ? ' practice-dark' : ''}`
  const title = `专项智能练习（${type === '全部' ? '综合' : type}）`

  const topbar = (
    <header className="pe-topbar">
      <button className="pe-icon" onClick={() => setConfirmExit(true)} title="退出练习" aria-label="退出练习">
        <Icon name="back" size={18} />
      </button>
      <div className="pe-timer">
        <Icon name="clock" size={14} />
        <span>{formatClock(elapsed)}</span>
        {!reportOpen && (
          <button onClick={() => setPaused((value) => !value)} title={paused ? '继续计时' : '暂停计时'} aria-label={paused ? '继续计时' : '暂停计时'}>
            <Icon name={paused ? 'play' : 'pause'} size={14} />
          </button>
        )}
      </div>
      <div className="pe-title">{title}</div>
      <div className="pe-actions">
        <button className="pe-icon" onClick={() => setSettingsOpen((value) => !value)} title="设置" aria-label="设置">
          <Icon name="settings" size={17} />
        </button>
        <button className="pe-icon" onClick={download} title="下载练习题" aria-label="下载练习题">
          <Icon name="download" size={17} />
        </button>
        {!reportOpen && (
          <button className="pe-submit" onClick={() => setConfirmSubmit(true)} disabled={saving}>
            <Icon name="check" size={14} /> {saving ? '交卷中…' : '交卷'}
          </button>
        )}
      </div>
      {settingsOpen && (
        <div className="pe-settings">
          <div className="pe-settings-title">练习设置</div>
          <div className="pe-settings-row">
            <span>字号</span>
            <div className="segmented">
              {FONT_SIZES.map((font, index) => (
                <button key={font.key} className={fontIndex === index ? 'active' : ''} onClick={() => { setFontIndex(index); setFontIndexState(index) }}>
                  {font.label}
                </button>
              ))}
            </div>
          </div>
          <div className="pe-settings-row">
            <span>夜间模式</span>
            <button
              className={`btn btn-sm${dark ? ' btn-primary' : ''}`}
              onClick={() => {
                const next: ThemeKey = dark ? 'light' : 'dark'
                setTheme(next)
                setThemeState(next)
              }}
            >
              {dark ? '已开启' : '已关闭'}
            </button>
          </div>
          <div className="pe-settings-hint">字号与主题设置会同步到工作台设置</div>
        </div>
      )}
    </header>
  )

  const dialogs = (
    <>
      {confirmSubmit && (
        <ConfirmDialog
          message={`确认交卷吗？已作答 ${answeredCount} 题，未作答 ${pool.length - answeredCount} 题，标记 ${markedCount} 题。交卷后将写入练习记录并生成成绩报告。`}
          onConfirm={() => void submitExam()}
          onCancel={() => setConfirmSubmit(false)}
          danger={false}
        />
      )}
      {confirmExit && (
        <ConfirmDialog
          message="退出后本轮作答进度将清空，确认退出练习吗？"
          onConfirm={exit}
          onCancel={() => setConfirmExit(false)}
        />
      )}
    </>
  )

  if (reportOpen) {
    const correctCount = results.filter((result) => result.correct).length
    const wrongCount = results.filter((result) => result.chosen && !result.correct).length
    const skippedCount = results.length - correctCount - wrongCount
    const accuracyItems = pool.filter((item) => typeof item.accuracy === 'number')
    const difficulty = accuracyItems.length
      ? Math.max(1, Math.min(5, 10 - accuracyItems.reduce((sum, item) => sum + (item.accuracy ?? 0), 0) / accuracyItems.length / 20)).toFixed(1)
      : '—'
    const modules = Array.from(new Set(pool.map((item) => item.type || '综合')))
    const moduleStats = modules.map((name) => {
      const indexes = pool.map((item, i) => (item.type || '综合') === name ? i : -1).filter((i) => i >= 0)
      const correct = indexes.filter((i) => results[i]?.correct).length
      const wrong = indexes.filter((i) => results[i]?.chosen && !results[i]?.correct).length
      return { name, total: indexes.length, correct, wrong, skipped: indexes.length - correct - wrong }
    })
    return (
      <div className={examClass}>
        {topbar}
        <div className="pe-scroll pe-report-scroll">
          <div className="pe-report">
            <section className="pr-section pr-score-section">
              <div className="pr-section-head">
                <h2><span className="pr-section-icon">▦</span>得分数据</h2>
                <span className="pr-difficulty">◆ 难度 {difficulty}</span>
              </div>
              <div className="pr-score-grid">
                <div className="pr-score-cell">
                  <div className="pr-score-value blue">{correctCount}<span>/{results.length}</span></div>
                  <div className="pr-score-label">答对题目数</div>
                </div>
                <div className="pr-score-cell">
                  <div className="pr-score-value">{elapsed}s</div>
                  <div className="pr-score-label">总用时</div>
                </div>
              </div>
            </section>

            <section className="pr-section">
              <div className="pr-section-head"><h2><span className="pr-section-icon">▤</span>考试情况</h2></div>
              <div className="pr-module-row">
                <span className="pr-module-icon pr-module-main">行</span>
                <b className="pr-module-name">行测</b>
                <div className="pr-module-stats">
                  <span>共计 <b>{results.length}</b>题</span>
                  <span>答对 <b className="blue">{correctCount}</b>题</span>
                  <span>答错 <b className="red">{wrongCount}</b>题</span>
                  <span>未答 <b>{skippedCount}</b>题</span>
                  <span>用时 <b>{elapsed}</b>秒</span>
                </div>
              </div>
              {moduleStats.map((module) => (
                <div className="pr-module-row" key={module.name}>
                  <span className="pr-module-icon pr-module-sub">✓</span>
                  <b className="pr-module-name">{module.name}</b>
                  <div className="pr-module-stats">
                    <span>总题数 <b>{module.total}</b>题</span>
                    <span>答对 <b className="blue">{module.correct}</b>道</span>
                    <span>正确率 <b>{module.total ? Math.round((module.correct / module.total) * 100) : 0}%</b></span>
                    <span>用时 <b>{elapsed}</b>秒</span>
                  </div>
                </div>
              ))}
            </section>

            <div className="pr-list">
              {results.map((result, index) => {
                const item = pool[index]
                const options = (item?.options ?? [])
                  .map((text, i) => ({ text, letter: String.fromCharCode(65 + i) }))
                  .filter((option) => option.text.trim())
                const answer = (result.answer || '').toUpperCase()
                const chosen = result.chosen.toUpperCase()
                return (
                  <article id={`pr-q-${index}`} key={result.id} className={`pr-question ${result.correct ? 'ok' : 'bad'}`}>
                    <div className="pr-q-head">
                      <span className="pr-q-index">{index + 1}.</span>
                      <span className="pr-q-type">{item?.subType || '单选题'}</span>
                      <span className="pe-q-tools">
                        <button className={bookmarks[result.id] ? 'on' : ''} onClick={() => item && toggleBookmark(item)} title="收藏本题"><Icon name="bookmark" size={16} /></button>
                        <button className={sketchId === result.id ? 'on' : ''} onClick={() => { setSketchId(result.id); setSketchEditing(true) }} title="在题目上写草稿" aria-label="在题目上写草稿"><Icon name="edit" size={16} /></button>
                        <button className={marks[result.id] ? 'on' : ''} onClick={() => item && toggleMark(item)} title="标记本题"><Icon name="flag" size={16} /></button>
                      </span>
                    </div>
                    <QuestionStem text={result.title} answer={result.answer} images={item?.images ?? []} altPrefix="题目图片" className="pr-q-text" />
                    {options.length > 0 && (
                      <div className="pe-options">
                        {options.map((option) => (
                          <div
                            key={option.letter}
                            className={`pe-option pr-option${answer === option.letter ? ` correct${result.correct ? ' hit' : ''}` : ''}${chosen === option.letter && !result.correct ? ' wrong' : ''}`}
                          >
                            <span className="pe-option-key">{option.letter}</span>
                            <span>{option.text}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="pr-q-foot">
                      <span className="pr-answer-line">
                        我的答案：<b className={result.correct ? 'ans-ok' : 'ans-bad'}>{chosen || '未作答'}</b>
                        <span className="pr-answer-sep">·</span>
                        正确答案：<b className="ans-ok">{answer || '—'}</b>
                      </span>
                      {result.note && <span>笔记：{result.note}</span>}
                      {result.marked && <span className="pe-foot-mark">已标记</span>}
                    </div>
                    <Link className="pe-report-link" to={`/mistakes/${result.id}`}>查看解析与复盘 <Icon name="chevron" size={13} /></Link>
                    {sketchId === result.id && (
                      <QuestionSketch questionId={result.id} active={sketchEditing} onExit={() => setSketchEditing(false)} cardPrefix="pr-q-" />
                    )}
                  </article>
                )
              })}
            </div>
            <div className="pr-bottom-actions">
              <button className="btn" onClick={start}><Icon name="refresh" size={15} /> 再练一轮</button>
              <button className="btn" onClick={exit}><Icon name="back" size={15} /> 返回错题库</button>
            </div>
          </div>
        </div>
        <div className="pe-sheet">
          <button className="pe-sheet-tab" onClick={() => setSheetOpen((value) => !value)} aria-expanded={sheetOpen}>
            <Icon name="list" size={15} />
            <span>答题卡</span>
            <b>{correctCount}/{results.length}</b>
            <Icon name="chevron" size={14} style={{ transform: sheetOpen ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
          </button>
          {sheetOpen && (
            <div className="pe-sheet-body">
              <div className="pe-sheet-grid">
                {results.map((result, index) => (
                  <button key={result.id} className={`pe-sheet-num${result.correct ? ' answered' : ''}${result.marked ? ' marked' : ''}`} onClick={() => jumpTo(index)}>
                    {index + 1}
                  </button>
                ))}
              </div>
              <div className="pe-sheet-legend">
                <span><i className="legend-answered" /> 答对 {correctCount}</span>
                <span><i className="legend-empty" /> 未答对 {results.length - correctCount}</span>
                <span><i className="legend-marked" /> 标记 {markedCount}</span>
              </div>
            </div>
          )}
        </div>
        {dialogs}
      </div>
    )
  }

  return (
    <div className={examClass}>
      {topbar}
      {paused && <div className="pe-paused">已暂停 · 点击顶部播放按钮继续计时</div>}
      <div className="pe-scroll" ref={scrollRef}>
        {pool.length === 0 ? (
          <div className="pe-empty">
            <h2>本轮没有题目</h2>
            <button className="btn btn-primary" onClick={exit}>重新选择</button>
          </div>
        ) : pool.map((item, index) => {
          const options = visibleOptions(item)
          const chosen = answerFor(item)
          return (
            <article id={`practice-q-${index}`} key={item.id} className={`pe-question${activeIndex === index ? ' active' : ''}`}>
              <div className="pe-q-head">
                <span className="pe-q-no">{index + 1}.</span>
                <span className="chip chip-primary">{item.subType || item.type}</span>
                <span className="pe-q-tools">
                  <button className={bookmarks[item.id] ? 'on' : ''} onClick={() => toggleBookmark(item)} title="收藏本题" aria-label="收藏本题"><Icon name="bookmark" size={16} /></button>
                  <button className={sketchId === item.id ? 'on' : ''} onClick={() => { setSketchId(item.id); setSketchEditing(true) }} title="在题目上写草稿" aria-label="在题目上写草稿"><Icon name="edit" size={16} /></button>
                  <button className={marks[item.id] ? 'on' : ''} onClick={() => toggleMark(item)} title="标记本题" aria-label="标记本题"><Icon name="flag" size={16} /></button>
                </span>
              </div>
              <QuestionStem text={item.title} answer={item.answer} images={item.images} altPrefix="题目图片" className="pe-q-text" />
              {options.length > 0 ? (
                <div className="pe-options">
                  {options.map((option) => (
                    <button
                      key={option.letter}
                      className={`pe-option${chosen === option.letter ? ' selected' : ''}`}
                      onClick={() => choose(item, option.letter)}
                    >
                      <span className="pe-option-key">{option.letter}</span>
                      <span>{option.text}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="form-field" style={{ marginTop: 16 }}>
                  <label className="form-label">输入你的答案</label>
                  <input
                    className="input"
                    value={textAnswers[item.id] ?? ''}
                    onChange={(event) => setTextAnswers((prev) => ({ ...prev, [item.id]: event.target.value }))}
                    placeholder="输入答案，交卷后统一判分"
                  />
                </div>
              )}
              {(notes[item.id] || marks[item.id]) && (
                <div className="pe-q-foot">
                  {marks[item.id] && <span className="pe-foot-mark"><Icon name="flag" size={13} /> 已标记</span>}
                  {notes[item.id] && <span className="pe-foot-note"><Icon name="note" size={13} /> {notes[item.id]}</span>}
                </div>
              )}
              {sketchId === item.id && (
                <QuestionSketch questionId={item.id} active={sketchEditing} onExit={() => setSketchEditing(false)} cardPrefix="practice-q-" />
              )}
            </article>
          )
        })}
        <div className="pe-bottom-space" />
      </div>

      <div className={`pe-sheet${sheetOpen ? ' open' : ''}`}>
        <button className="pe-sheet-tab" onClick={() => setSheetOpen((value) => !value)} aria-expanded={sheetOpen}>
          <Icon name="list" size={15} />
          <span>答题卡</span>
          <b>{activeIndex + 1}/{pool.length}</b>
          <Icon name="chevron" size={14} style={{ transform: sheetOpen ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
        </button>
        {sheetOpen && (
          <div className="pe-sheet-body">
            <div className="pe-sheet-grid">
              {pool.map((item, index) => (
                <button
                  key={item.id}
                  className={`pe-sheet-num${index === activeIndex ? ' current' : ''}${answerFor(item) ? ' answered' : ''}${marks[item.id] ? ' marked' : ''}`}
                  onClick={() => jumpTo(index)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
            <div className="pe-sheet-legend">
              <span><i className="legend-answered" /> 已作答 {answeredCount}</span>
              <span><i className="legend-empty" /> 未作答 {pool.length - answeredCount}</span>
              <span><i className="legend-marked" /> 标记 {markedCount}</span>
            </div>
          </div>
        )}
      </div>
      {dialogs}
    </div>
  )
}
