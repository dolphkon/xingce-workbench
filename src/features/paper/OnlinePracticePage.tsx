import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ConfirmDialog, Icon } from '../../components/ui'
import { useCollection } from '../../lib/hooks'
import { put, readCachedAll, remove } from '../../lib/db'
import { dateKey, formatClock, uid } from '../../lib/utils'
import type { Mistake, Paper, PracticeRecord } from '../../types'
import PaperExamRunner, { type ExamResult } from './PaperExamRunner'
import PaperWorkbench from './PaperWorkbench'
import SmartComposePanel from '../bank/SmartComposePanel'

/** 在线刷题：浏览题库管理页推送来的套卷、逐题管理、刷题、错题入库与历史记录。
 *  文档转试卷流程已迁移到题库管理页（/question-bank）。 */
export default function OnlinePracticePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { items: papers, refresh: refreshPapers } = useCollection('papers')
  const { items: records, refresh: refreshRecords } = useCollection('practiceRecords')
  const { items: bank } = useCollection('bank')
  const { items: mistakes } = useCollection('mistakes')

  const [activePaper, setActivePaper] = useState<Paper | null>(null)
  const [historyPaperId, setHistoryPaperId] = useState<string | null>(null)
  const [confirmDeletePaper, setConfirmDeletePaper] = useState<Paper | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  // 从题库管理页推送过来时，直接选中刚生成的套卷
  const [activePaperId, setActivePaperId] = useState<string | null>(
    () => (location.state as { activePaperId?: string } | null)?.activePaperId ?? null,
  )

  useEffect(() => { refreshPapers(); refreshRecords() }, [])
  useEffect(() => {
    if (!activePaperId && papers.length > 0) setActivePaperId(papers[0].id)
  }, [papers, activePaperId])

  const renamePaper = async (paper: Paper, title: string) => {
    await put('papers', { ...paper, title, updatedAt: Date.now() })
    refreshPapers()
  }

  /** 保存/新增试卷中的一道题 */
  const saveQuestion = async (paper: Paper, index: number | null, question: Paper['questions'][number]) => {
    const questions = index === null
      ? [...paper.questions, question]
      : paper.questions.map((q, i) => i === index ? question : q)
    await put('papers', { ...paper, questions, questionCount: questions.length, updatedAt: Date.now() })
    refreshPapers()
  }

  /** 删除试卷中的一道题 */
  const deleteQuestion = async (paper: Paper, index: number) => {
    const questions = paper.questions.filter((_, i) => i !== index)
    await put('papers', { ...paper, questions, questionCount: questions.length, updatedAt: Date.now() })
    refreshPapers()
  }

  /** 收藏/取消收藏试卷中的一道题 */
  const toggleFavorite = async (paper: Paper, index: number) => {
    const questions = paper.questions.map((q, i) => i === index ? { ...q, favorite: !q.favorite } : q)
    await put('papers', { ...paper, questions, updatedAt: Date.now() })
    refreshPapers()
  }

  /** 批量回写本卷答案，一次写库完成 */
  const saveAnswers = async (paper: Paper, answers: Record<string, string>) => {
    const questions = paper.questions.map((question) => answers[question.id] === undefined
      ? question
      : { ...question, answer: answers[question.id] })
    await put('papers', { ...paper, questions, updatedAt: Date.now() })
    refreshPapers()
  }

  /** 导出试卷 JSON */
  const exportPaper = (paper: Paper) => {
    const blob = new Blob([JSON.stringify(paper, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${paper.title || '试卷'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const startExam = (paper: Paper) => {
    setActivePaper(paper)
  }

  const finishExam = async (results: ExamResult[], elapsed: number) => {
    if (!activePaper) return
    const now = Date.now()
    // 错题自动加入错题库：按题目 ID 去重，已存在则累加计数
    const wrongResults = results.filter((result) => result.chosen && !result.correct)
    const existing = new Map(readCachedAll('mistakes').map((item) => [item.id, item]))
    await Promise.all(wrongResults.map(async (result) => {
      const index = results.indexOf(result)
      const question = activePaper.questions[index]
      const found = existing.get(question.id)
      const record: Mistake = found
        ? {
          ...found,
          userAnswer: result.chosen,
          reviewCount: found.reviewCount + 1,
          lastReviewedAt: now,
          updatedAt: now,
          source: found.source || `${activePaper.title}（在线试卷）`,
        }
        : {
          id: question.id,
          title: question.title,
          type: question.type || '其他',
          options: question.options,
          answer: question.answer,
          userAnswer: result.chosen,
          analysis: question.analysis || '',
          tags: ['在线试卷'],
          images: question.images ?? [],
          createdAt: now,
          updatedAt: now,
          lastReviewedAt: now,
          reviewCount: 1,
          correctCount: 0,
          source: `${activePaper.title}（在线试卷）`,
          subType: question.subType,
          point: question.point,
          reviewStatus: 'unmastered',
        }
      await put('mistakes', record)
    }))

    // 写入练习记录
    const correctCount = results.filter((result) => result.correct).length
    const wrongCount = wrongResults.length
    const skippedCount = results.length - correctCount - wrongCount
    const history: PracticeRecord = {
      id: uid(),
      paperId: activePaper.id,
      paperTitle: activePaper.title,
      startedAt: now - elapsed * 1000,
      finishedAt: now,
      elapsed,
      total: results.length,
      correct: correctCount,
      wrong: wrongCount,
      skipped: skippedCount,
      details: results.map((result) => ({
        questionId: result.id, title: result.title, chosen: result.chosen,
        answer: result.answer, correct: result.correct,
      })),
      createdAt: now,
      updatedAt: now,
    }
    await put('practiceRecords', history)
    refreshRecords()
  }

  const exitExam = () => {
    setActivePaper(null)
    refreshPapers()
    refreshRecords()
  }

  if (activePaper) {
    return (
      <PaperExamRunner
        key={activePaper.id}
        title={`在线练习（${activePaper.title}）`}
        questions={activePaper.questions}
        sessionKey={activePaper.id}
        onFinish={finishExam}
        onExit={exitExam}
      />
    )
  }

  const historyFor = (paperId: string) => records.filter((record) => record.paperId === paperId).sort((a, b) => b.finishedAt - a.finishedAt)
  const historyPaper = historyPaperId ? papers.find((paper) => paper.id === historyPaperId) : null

  return (
    <div className="page online-practice-page">
      <div className="page-head">
        <div>
          <h1>在线刷题</h1>
          <p className="muted">在题库管理页用智能组卷生成套卷后，在这里选择套卷开始刷题。答错的题自动进入错题库。</p>
        </div>
        <div className="op-head-actions">
          <button className="btn" onClick={() => setComposeOpen(true)}><Icon name="layers" size={16} /> 智能组卷</button>
          <button className="btn btn-primary" onClick={() => navigate('/question-bank')}>
            <Icon name="layers" size={16} /> 去题库管理智能组卷
          </button>
        </div>
      </div>

      <PaperWorkbench
        papers={papers}
        activeId={activePaperId}
        onSelect={setActivePaperId}
        onStartExam={startExam}
        onShowHistory={setHistoryPaperId}
        onDeletePaper={setConfirmDeletePaper}
        onRenamePaper={(paper, title) => void renamePaper(paper, title)}
        onSaveQuestion={(paper, index, question) => void saveQuestion(paper, index, question)}
        onSaveAnswers={(paper, answers) => void saveAnswers(paper, answers)}
        onDeleteQuestion={(paper, index) => void deleteQuestion(paper, index)}
        onToggleFavorite={(paper, index) => void toggleFavorite(paper, index)}
        onExportPaper={exportPaper}
        onUpload={() => navigate('/question-bank')}
      />

      {historyPaper && (
        <div className="op-history-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setHistoryPaperId(null) }}>
          <div className="op-history-panel" role="dialog" aria-label="历史刷题记录">
            <div className="op-history-head">
              <h2>「{historyPaper.title}」刷题记录</h2>
              <button className="icon-btn" onClick={() => setHistoryPaperId(null)} aria-label="关闭"><Icon name="x" size={17} /></button>
            </div>
            {historyFor(historyPaper.id).length === 0 ? (
              <p className="muted">还没有刷题记录。</p>
            ) : (
              <div className="op-history-list">
                {historyFor(historyPaper.id).map((record) => (
                  <div className="op-history-item" key={record.id}>
                    <div className="op-history-row">
                      <b>{dateKey(new Date(record.finishedAt))}</b>
                      <span className="op-history-score">正确 {record.correct}/{record.total}</span>
                      <span className="op-history-rate">{record.total ? Math.round((record.correct / record.total) * 100) : 0}%</span>
                      <span className="muted small">用时 {formatClock(record.elapsed)}</span>
                    </div>
                    <div className="op-history-details">
                      {record.details.map((detail, index) => (
                        <span key={index} className={detail.correct ? 'ok' : 'bad'} title={detail.title}>
                          {index + 1}.{detail.correct ? '✓' : detail.chosen ? '✗' : '—'}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {composeOpen && (
        <SmartComposePanel
          bank={bank}
          mistakes={mistakes}
          onClose={() => setComposeOpen(false)}
          onComposed={(paper) => { refreshPapers(); setActivePaperId(paper.id) }}
        />
      )}

      {confirmDeletePaper && (
        <ConfirmDialog
          message={`确定删除试卷「${confirmDeletePaper.title}」吗？该试卷的历史记录也会一并删除。`}
          onCancel={() => setConfirmDeletePaper(null)}
          onConfirm={() => void (async () => {
            const paperId = confirmDeletePaper.id
            await Promise.all(historyFor(paperId).map((record) => remove('practiceRecords', record.id)))
            await remove('papers', paperId)
            refreshPapers(); refreshRecords()
            if (activePaperId === paperId) setActivePaperId(null)
            setConfirmDeletePaper(null)
          })()}
        />
      )}
    </div>
  )
}
