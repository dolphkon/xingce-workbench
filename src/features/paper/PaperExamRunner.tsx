import { useEffect, useMemo, useRef, useState } from 'react'
import { ConfirmDialog, Icon } from '../../components/ui'
import QuestionStem from '../../components/QuestionStem'
import QuestionSketch from '../mistakes/QuestionSketch'
import { FONT_SIZES, readFontIndex, setFontIndex } from '../../lib/fontSize'
import { THEME_CHANGE_EVENT, readTheme, setTheme, type ThemeKey } from '../../lib/theme'
import { formatClock, formatQuestionText } from '../../lib/utils'
import type { QuizQuestion } from '../../types'

interface ExamResult {
  id: string
  title: string
  chosen: string
  answer: string
  correct: boolean
  marked: boolean
}

const normalize = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '')

function shuffle<T>(input: T[]): T[] {
  const copy = [...input]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * 在线试卷考试运行器：复用「专项智能练习」的全屏 UI 与答题卡/计时/草稿。
 * 题目来自文档解析出的 QuizQuestion[]，交卷结果回传给上层写入错题库与练习记录。
 */
export default function PaperExamRunner({
  title,
  questions,
  onFinish,
  onExit,
}: {
  title: string
  questions: QuizQuestion[]
  onFinish: (results: ExamResult[], elapsed: number) => void | Promise<void>
  onExit: () => void
}) {
  const [pool] = useState<QuizQuestion[]>(() => shuffle(questions))
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({})
  const [marks, setMarks] = useState<Record<string, boolean>>({})
  const [bookmarks, setBookmarks] = useState<Record<string, boolean>>({})
  const [activeIndex, setActiveIndex] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(false)
  const [confirmExit, setConfirmExit] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [results, setResults] = useState<ExamResult[]>([])
  const [saving, setSaving] = useState(false)
  const [sketchId, setSketchId] = useState<string | null>(null)
  const [sketchEditing, setSketchEditing] = useState(false)
  const [fontIndex, setFontIndexState] = useState(readFontIndex)
  const [dark, setDark] = useState(() => readTheme() === 'dark')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (reportOpen || paused) return
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [reportOpen, paused])

  useEffect(() => {
    setFontIndex(readFontIndex())
    const onTheme = () => setDark(readTheme() === 'dark')
    window.addEventListener(THEME_CHANGE_EVENT, onTheme)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
  }, [])

  const answerFor = (item: QuizQuestion) => {
    const letters = answers[item.id]
    if (letters) return letters
    const text = (textAnswers[item.id] ?? '').trim()
    return text
  }
  const answeredCount = pool.filter((item) => Boolean(answerFor(item))).length
  const markedCount = pool.filter((item) => marks[item.id]).length

  const visibleOptions = useMemo(() => (item: QuizQuestion) => (item.options ?? [])
    .map((text, i) => ({ text, letter: String.fromCharCode(65 + i) }))
    .filter((option) => option.text.trim()), [])

  const choose = (item: QuizQuestion, letter: string) => {
    setAnswers((prev) => ({ ...prev, [item.id]: prev[item.id] === letter ? '' : letter }))
  }
  const toggleMark = (item: QuizQuestion) => setMarks((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
  const toggleBookmark = (item: QuizQuestion) => setBookmarks((prev) => ({ ...prev, [item.id]: !prev[item.id] }))

  const jumpTo = (index: number) => {
    setActiveIndex(index)
    setSheetOpen(false)
    window.requestAnimationFrame(() => {
      document.getElementById(`paper-practice-q-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const submitExam = async () => {
    setConfirmSubmit(false)
    if (saving) return
    setSaving(true)
    try {
      const built = pool.map((item) => {
        const chosen = (answerFor(item) || '').toUpperCase()
        const correct = Boolean(chosen) && normalize(chosen) === normalize(item.answer)
        return { id: item.id, title: item.title, chosen, answer: item.answer, correct, marked: Boolean(marks[item.id]) }
      })
      await onFinish(built, elapsed)
      setResults(built)
      setReportOpen(true)
      setPaused(true)
      setSheetOpen(false)
    } finally {
      setSaving(false)
    }
  }

  const download = () => {
    const source = reportOpen ? results : pool.map((item) => ({
      id: item.id, title: item.title, chosen: answerFor(item), answer: item.answer,
      correct: false, marked: Boolean(marks[item.id]),
    }))
    const lines = [`# ${title} · 练习报告`, '', `- 题量：${source.length}`, `- 用时：${formatClock(elapsed)}`, '- 导出时间：' + new Date().toLocaleString('zh-CN'), '']
    source.forEach((result, index) => {
      const item = pool[index]
      lines.push(`### ${index + 1}. ${formatQuestionText(result.title)}`)
      lines.push('', ...(item?.options ?? []).map((text, i) => `${String.fromCharCode(65 + i)}. ${text}`))
      lines.push('', `你的答案：${result.chosen || '未作答'}`, `正确答案：${result.answer || '—'}`, result.correct ? '结果：正确' : '结果：错误或未答', '')
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${title}-${Date.now()}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const examClass = `practice-exam${dark ? ' practice-dark' : ''}`

  const topbar = (
    <header className="pe-topbar">
      <button className="pe-icon" onClick={() => setConfirmExit(true)} title="退出练习" aria-label="退出练习"><Icon name="back" size={18} /></button>
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
        <button className="pe-icon" onClick={() => setSettingsOpen((value) => !value)} title="设置" aria-label="设置"><Icon name="settings" size={17} /></button>
        <button className="pe-icon" onClick={download} title="下载练习题" aria-label="下载练习题"><Icon name="download" size={17} /></button>
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
                <button key={font.key} className={fontIndex === index ? 'active' : ''} onClick={() => { setFontIndex(index); setFontIndexState(index) }}>{font.label}</button>
              ))}
            </div>
          </div>
          <div className="pe-settings-row">
            <span>夜间模式</span>
            <button className={`btn btn-sm${dark ? ' btn-primary' : ''}`} onClick={() => {
              const next: ThemeKey = dark ? 'light' : 'dark'
              setTheme(next); setDark(next === 'dark')
            }}>{dark ? '已开启' : '已关闭'}</button>
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
          message={`确认交卷吗？已作答 ${answeredCount} 题，未作答 ${pool.length - answeredCount} 题。答错的题将自动加入错题库。`}
          onConfirm={() => void submitExam()} onCancel={() => setConfirmSubmit(false)} danger={false}
        />
      )}
      {confirmExit && (
        <ConfirmDialog message="退出后本轮作答进度将清空，确认退出练习吗？" onConfirm={onExit} onCancel={() => setConfirmExit(false)} />
      )}
    </>
  )

  if (reportOpen) {
    const correctCount = results.filter((result) => result.correct).length
    const wrongCount = results.filter((result) => result.chosen && !result.correct).length
    const skippedCount = results.length - correctCount - wrongCount
    return (
      <div className={examClass}>
        {topbar}
        <div className="pe-scroll pe-report-scroll">
          <div className="pe-report">
            <section className="pr-section pr-score-section">
              <div className="pr-section-head"><h2><span className="pr-section-icon">▦</span>得分数据</h2></div>
              <div className="pr-score-grid">
                <div className="pr-score-cell">
                  <div className="pr-score-value blue">{correctCount}<span>/{results.length}</span></div>
                  <div className="pr-score-label">答对题目数</div>
                </div>
                <div className="pr-score-cell">
                  <div className="pr-score-value">{formatClock(elapsed)}</div>
                  <div className="pr-score-label">总用时</div>
                </div>
              </div>
            </section>
            <section className="pr-section">
              <div className="pr-section-head"><h2><span className="pr-section-icon">▤</span>考试情况</h2></div>
              <div className="pr-module-row">
                <span className="pr-module-icon pr-module-main">卷</span>
                <b className="pr-module-name">在线试卷</b>
                <div className="pr-module-stats">
                  <span>共计 <b>{results.length}</b>题</span>
                  <span>答对 <b className="blue">{correctCount}</b>题</span>
                  <span>答错 <b className="red">{wrongCount}</b>题</span>
                  <span>未答 <b>{skippedCount}</b>题</span>
                </div>
              </div>
            </section>
            <div className="pr-list">
              {results.map((result, index) => {
                const item = pool[index]
                const options = (item?.options ?? []).map((text, i) => ({ text, letter: String.fromCharCode(65 + i) })).filter((o) => o.text.trim())
                const answer = (result.answer || '').toUpperCase()
                const chosen = result.chosen.toUpperCase()
                return (
                  <article id={`paper-pr-q-${index}`} key={result.id} className={`pr-question ${result.correct ? 'ok' : 'bad'}`}>
                    <div className="pr-q-head">
                      <span className="pr-q-index">{index + 1}.</span>
                      <span className="pr-q-type">{item?.type || '单选题'}</span>
                      <span className="pe-q-tools">
                        <button className={bookmarks[result.id] ? 'on' : ''} onClick={() => item && toggleBookmark(item)} title="收藏本题"><Icon name="bookmark" size={16} /></button>
                        <button className={sketchId === result.id ? 'on' : ''} onClick={() => { setSketchId(result.id); setSketchEditing(true) }} title="在题目上写草稿"><Icon name="edit" size={16} /></button>
                        <button className={marks[result.id] ? 'on' : ''} onClick={() => item && toggleMark(item)} title="标记本题"><Icon name="flag" size={16} /></button>
                      </span>
                    </div>
                    <QuestionStem text={result.title} answer={result.answer} images={item?.images ?? []} altPrefix="题目图片" className="pr-q-text" />
                    {options.length > 0 && (
                      <div className="pe-options">
                        {options.map((option) => (
                          <div key={option.letter} className={`pe-option pr-option${answer === option.letter ? ` correct${result.correct ? ' hit' : ''}` : ''}${chosen === option.letter && !result.correct ? ' wrong' : ''}`}>
                            <span className="pe-option-key">{option.letter}</span><span>{option.text}</span>
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
                      {result.marked && <span className="pe-foot-mark">已标记</span>}
                    </div>
                    {item?.analysis && <div className="pr-analysis">解析：{formatQuestionText(item.analysis)}</div>}
                    {sketchId === result.id && (
                      <QuestionSketch questionId={result.id} active={sketchEditing} onExit={() => setSketchEditing(false)} cardPrefix="paper-pr-q-" />
                    )}
                  </article>
                )
              })}
            </div>
            <div className="pr-bottom-actions">
              <button className="btn" onClick={onExit}><Icon name="back" size={15} /> 返回试卷</button>
            </div>
          </div>
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
        {pool.map((item, index) => {
          const options = visibleOptions(item)
          const chosen = answerFor(item)
          return (
            <article id={`paper-practice-q-${index}`} key={item.id} className={`pe-question${activeIndex === index ? ' active' : ''}`}>
              <div className="pe-q-head">
                <span className="pe-q-no">{index + 1}.</span>
                <span className="chip chip-primary">{item.type || '单选题'}</span>
                <span className="pe-q-tools">
                  <button className={bookmarks[item.id] ? 'on' : ''} onClick={() => toggleBookmark(item)} title="收藏本题"><Icon name="bookmark" size={16} /></button>
                  <button className={sketchId === item.id ? 'on' : ''} onClick={() => { setSketchId(item.id); setSketchEditing(true) }} title="在题目上写草稿"><Icon name="edit" size={16} /></button>
                  <button className={marks[item.id] ? 'on' : ''} onClick={() => toggleMark(item)} title="标记本题"><Icon name="flag" size={16} /></button>
                </span>
              </div>
              <QuestionStem text={item.title} answer={item.answer} images={item.images ?? []} altPrefix="题目图片" className="pe-q-text" />
              {options.length > 0 ? (
                <div className="pe-options">
                  {options.map((option) => (
                    <button key={option.letter} className={`pe-option${chosen === option.letter ? ' selected' : ''}`} onClick={() => choose(item, option.letter)}>
                      <span className="pe-option-key">{option.letter}</span><span>{option.text}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="form-field" style={{ marginTop: 16 }}>
                  <label className="form-label">输入你的答案</label>
                  <input className="input" value={textAnswers[item.id] ?? ''} onChange={(e) => setTextAnswers((prev) => ({ ...prev, [item.id]: e.target.value }))} placeholder="输入答案，交卷后统一判分" />
                </div>
              )}
              {marks[item.id] && <div className="pe-q-foot"><span className="pe-foot-mark"><Icon name="flag" size={13} /> 已标记</span></div>}
              {sketchId === item.id && (
                <QuestionSketch questionId={item.id} active={sketchEditing} onExit={() => setSketchEditing(false)} cardPrefix="paper-practice-q-" />
              )}
            </article>
          )
        })}
        <div className="pe-bottom-space" />
      </div>
      <div className={`pe-sheet${sheetOpen ? ' open' : ''}`}>
        <button className="pe-sheet-tab" onClick={() => setSheetOpen((value) => !value)} aria-expanded={sheetOpen}>
          <Icon name="list" size={15} /><span>答题卡</span><b>{activeIndex + 1}/{pool.length}</b>
          <Icon name="chevron" size={14} style={{ transform: sheetOpen ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
        </button>
        {sheetOpen && (
          <div className="pe-sheet-body">
            <div className="pe-sheet-grid">
              {pool.map((item, index) => (
                <button key={item.id} className={`pe-sheet-num${index === activeIndex ? ' current' : ''}${answerFor(item) ? ' answered' : ''}${marks[item.id] ? ' marked' : ''}`} onClick={() => jumpTo(index)}>{index + 1}</button>
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

export type { ExamResult }
