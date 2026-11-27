import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog, Icon, Modal } from '../../components/ui'
import CircularProgress from '../../components/CircularProgress'
import { useCollection } from '../../lib/hooks'
import { put, readCachedAll, remove } from '../../lib/db'
import { loadDocFile } from '../../lib/docFile'
import { probeLlm, type LlmBlockReason, type LlmProbe } from '../../lib/llm'
import {
  inspectQuestion, parseDocumentToQuestions, parseFileKind, type ParseProgress,
} from '../../lib/paperParser'
import { dateKey, formatClock, uid } from '../../lib/utils'
import type { KnowledgeDoc, Mistake, Paper, PracticeRecord, QuizQuestion } from '../../types'
import PaperExamRunner, { type ExamResult } from './PaperExamRunner'
import QuestionReviewModal from './QuestionReviewModal'
import PaperWorkbench from './PaperWorkbench'

type View = 'list' | 'upload' | 'exam'

/** 把题干拆成「共用材料 / 题目正文」两段，便于清晰排版 */
function splitStem(title: string): { material: string; stem: string } {
  const parts = title.split('【题目】')
  if (parts.length === 2) {
    return { material: parts[0].replace(/^【共用材料】/, '').trim(), stem: parts[1].trim() }
  }
  return { material: '', stem: title.trim() }
}

interface Draft {
  questions: QuizQuestion[]
  method: string
  fileName: string
  fileType: string
  fileData: string
  usedLlm: boolean
  llmReason?: LlmBlockReason
  llmMessage?: string
}

/** 在线刷题：上传 PDF/Word → 多方式识别成卷 → 人工校对 → 确认组卷 → 类专项刷题 → 错题入库 → 历史记录 */
export default function OnlinePracticePage() {
  const { items: papers, refresh: refreshPapers } = useCollection('papers')
  const { items: records, refresh: refreshRecords } = useCollection('practiceRecords')
  const { items: docs } = useCollection('docs')

  const [view, setView] = useState<View>('list')
  const [activePaper, setActivePaper] = useState<Paper | null>(null)
  const [historyPaperId, setHistoryPaperId] = useState<string | null>(null)

  // 上传解析状态
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<ParseProgress>({ percent: 0, stage: 'prepare', message: '' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [parseError, setParseError] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const [confirmedIds, setConfirmedIds] = useState<string[]>([])
  const [showConfirmPaper, setShowConfirmPaper] = useState(false)
  const [llmProbe, setLlmProbe] = useState<LlmProbe | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [confirmDeletePaper, setConfirmDeletePaper] = useState<Paper | null>(null)
  // 后台工作台当前选中的套卷
  const [activePaperId, setActivePaperId] = useState<string | null>(null)

  useEffect(() => {
    if (!activePaperId && papers.length > 0) setActivePaperId(papers[0].id)
  }, [papers, activePaperId])

  useEffect(() => { refreshPapers(); refreshRecords() }, [])
  // 运行时探测大模型能力（不阻塞首屏；GitHub Pages 会得到 origin 降级提示）
  useEffect(() => { void probeLlm().then(setLlmProbe) }, [])

  const applyResult = (result: Awaited<ReturnType<typeof parseDocumentToQuestions>>, fileName: string, fileType: string, fileData: string, defaultTitle: string) => {
    setDraft({
      questions: result.questions,
      method: result.method,
      fileName,
      fileType: fileType || `application/${fileName.split('.').pop()}`,
      fileData,
      usedLlm: result.usedLlm,
      llmReason: result.llmReason,
      llmMessage: result.llmMessage,
    })
    setTitleInput(defaultTitle)
    setConfirmedIds([])
    setView('upload')
  }

  const handleFile = async (file: File) => {
    setParseError('')
    setDraft(null)
    setReviewIndex(null)
    setConfirmedIds([])
    if (parseFileKind(file.name, file.type) === 'unsupported') {
      setParseError('仅支持 PDF 或 Word（.docx）文档，请选择对应格式的文件。')
      return
    }
    setUploading(true)
    setProgress({ percent: 5, stage: 'prepare', message: '正在读取文件…' })
    try {
      const loaded = await loadDocFile(file)
      const fileData = loaded.fileData ?? ''
      if (!fileData) throw new Error('文件内容读取失败')
      const result = await parseDocumentToQuestions(fileData, file.name, file.type, setProgress)
      applyResult(result, file.name, file.type, fileData, loaded.title)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '解析失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  const savePaper = async () => {
    if (!draft) return
    const now = Date.now()
    const paper: Paper = {
      id: uid(),
      title: titleInput.trim() || draft.fileName.replace(/\.[^.]+$/, ''),
      fileName: draft.fileName,
      fileType: draft.fileType,
      fileData: draft.fileData,
      questions: draft.questions,
      questionCount: draft.questions.length,
      parseMethod: draft.method,
      createdAt: now,
      updatedAt: now,
    }
    await put('papers', paper)
    refreshPapers()
    setActivePaperId(paper.id)
    setDraft(null)
    setConfirmedIds([])
    setShowConfirmPaper(false)
    setView('list')
  }

  /** 重命名试卷 */
  const renamePaper = async (paper: Paper, title: string) => {
    await put('papers', { ...paper, title, updatedAt: Date.now() })
    refreshPapers()
  }

  /** 保存/新增试卷中的一道题 */
  const saveQuestion = async (paper: Paper, index: number | null, question: QuizQuestion) => {
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
    setView('exam')
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
    setView('list')
    refreshPapers()
    refreshRecords()
  }

  const openFromKnowledgeDoc = (doc: KnowledgeDoc) => {
    void (async () => {
      setUploading(true)
      setProgress({ percent: 5, stage: 'prepare', message: '正在读取知识库文档…' })
      try {
        if (!doc.fileData) throw new Error('文档内容为空')
        const result = await parseDocumentToQuestions(doc.fileData, doc.fileName || doc.title, doc.fileType || '', setProgress)
        applyResult(result, doc.fileName || doc.title, doc.fileType || '', doc.fileData, doc.title)
      } catch (err) {
        setParseError(err instanceof Error ? err.message : '解析失败')
      } finally {
        setUploading(false)
      }
    })()
  }

  const markConfirmed = (index: number) => {
    const q = draft?.questions[index]
    if (!q) return
    setConfirmedIds((prev) => prev.includes(q.id) ? prev : [...prev, q.id])
  }

  if (view === 'exam' && activePaper) {
    return (
      <PaperExamRunner
        title={`在线练习（${activePaper.title}）`}
        questions={activePaper.questions}
        onFinish={finishExam}
        onExit={exitExam}
      />
    )
  }

  const historyFor = (paperId: string) => records.filter((record) => record.paperId === paperId).sort((a, b) => b.finishedAt - a.finishedAt)
  const historyPaper = historyPaperId ? papers.find((paper) => paper.id === historyPaperId) : null
  const pendingCount = draft ? draft.questions.filter((q) => !confirmedIds.includes(q.id)).length : 0

  return (
    <div className="page online-practice-page">
      <div className="page-head">
        <div>
          <h1>在线刷题</h1>
          <p className="muted">上传 PDF 或 Word 文档，智能拆题后逐题人工校对、确认组卷。同一文档可反复练习，答错的题自动进入错题库。</p>
        </div>
        <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Icon name="upload" size={16} /> {uploading ? '解析中…' : '上传文档'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
            event.target.value = ''
          }}
        />
      </div>

      {/* 智能拆题能力状态：运行时探测结果，给出精确提示 */}
      {llmProbe ? (
        <div className={`op-notice${llmProbe.available ? ' ok' : ' warn'}`}>
          <Icon name={llmProbe.available ? 'check' : 'info'} size={15} />
          {llmProbe.available
            ? '大模型智能拆题已就绪：上传文档后将优先用 AI 结构化拆题，再经人工校对。'
            : `${llmProbe.message} 规则拆题同样可用，识别后仍可逐题校对确认。`}
        </div>
      ) : (
        <div className="op-notice"><Icon name="info" size={15} /> 正在检测智能拆题能力…</div>
      )}

      {parseError && <div className="error-text op-error">{parseError}</div>}

      {uploading && <CircularProgress progress={progress} />}

      {view === 'upload' && draft && !uploading && (
        <div className="op-review">
          <div className="op-review-head">
            <div>
              <h2>识别完成 · {draft.questions.length} 道题</h2>
              <p className="muted small">拆题方式：{draft.method}</p>
            </div>
            <button className="btn" onClick={() => { setDraft(null); setView('list') }}><Icon name="back" size={15} /> 返回</button>
          </div>
          <div className="form-field">
            <label className="form-label">试卷名称</label>
            <input className="input" value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="给这份试卷起个名字" />
          </div>
          <div className={`op-review-tip${pendingCount === 0 ? ' ok' : ''}`}>
            <Icon name={pendingCount === 0 ? 'check' : 'info'} size={15} />
            {pendingCount === 0
              ? <>全部 <b>{draft.questions.length}</b> 道题已完成校对，可确认组卷。</>
              : <>请逐题校对确认：还有 <b>{pendingCount}</b> 道题未确认。点击每题的「校对」核对题干、选项与答案后保存，或点「确认无误」快速通过。</>}
          </div>
          <div className="op-review-list">
            {draft.questions.map((question, index) => {
              const confidence = inspectQuestion(question)
              const parsed = splitStem(question.title)
              const filled = question.options.map((option, i) => ({ option, i })).filter((item) => item.option.trim())
              const confirmed = confirmedIds.includes(question.id)
              return (
                <div className={`op-review-item${confirmed ? ' confirmed' : ''}${confidence.needsReview && !confirmed ? ' pending' : ''}`} key={question.id}>
                  <div className="op-review-item-head">
                    <span className="op-q-index">第 {index + 1} 题</span>
                    {confirmed
                      ? <span className="op-confirmed-flag"><Icon name="check" size={12} /> 已确认</span>
                      : <span className="op-pending-flag">待校对</span>}
                    <button className="btn btn-sm" onClick={() => setReviewIndex(index)}><Icon name="edit" size={14} /> 校对</button>
                    {!confirmed && <button className="btn btn-sm btn-primary" onClick={() => markConfirmed(index)}><Icon name="check" size={14} /> 确认无误</button>}
                  </div>
                  {parsed.material && (
                    <div className="op-review-material">
                      <div className="op-material-label">共用材料</div>
                      <div className="op-preserve">{parsed.material}</div>
                    </div>
                  )}
                  <div className="op-review-q op-preserve">
                    <b>{index + 1}.</b> {parsed.stem}
                  </div>
                  <div className="op-review-opts">
                    {filled.length > 0 ? filled.map(({ option, i }) => (
                      <div className="op-review-opt" key={i}>
                        <span className="op-option-key">{String.fromCharCode(65 + i)}</span>
                        <span className="op-preserve">{option}</span>
                      </div>
                    )) : <span className="muted">（未识别到选项，请校对补充）</span>}
                  </div>
                  <div className={`op-review-answer${confidence.missingAnswer ? ' missing' : ''}`}>
                    正确答案：<b>{question.answer || '未识别 · 请校对填写'}</b>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="op-review-actions">
            <button className="btn" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={15} /> 重新上传</button>
            <button className="btn btn-primary" onClick={() => setShowConfirmPaper(true)}><Icon name="layers" size={16} /> 确认组卷</button>
          </div>
        </div>
      )}

      <PaperWorkbench
        papers={papers}
        activeId={activePaperId}
        onSelect={setActivePaperId}
        onStartExam={startExam}
        onShowHistory={setHistoryPaperId}
        onDeletePaper={setConfirmDeletePaper}
        onRenamePaper={(paper, title) => void renamePaper(paper, title)}
        onSaveQuestion={(paper, index, question) => void saveQuestion(paper, index, question)}
        onDeleteQuestion={(paper, index) => void deleteQuestion(paper, index)}
        onToggleFavorite={(paper, index) => void toggleFavorite(paper, index)}
        onExportPaper={exportPaper}
        onUpload={() => fileInputRef.current?.click()}
      />

      {docs.filter((doc) => doc.kind === 'file' && /\.(pdf|docx)$/i.test(doc.fileName || '')).length > 0 && (
        <section className="op-section">
          <div className="op-section-head"><h2>从知识库文档创建</h2></div>
          <div className="op-doc-list">
            {docs.filter((doc) => doc.kind === 'file' && /\.(pdf|docx)$/i.test(doc.fileName || '')).map((doc) => (
              <button className="op-doc-row" key={doc.id} onClick={() => openFromKnowledgeDoc(doc)} disabled={uploading}>
                <Icon name="filetext" size={16} />
                <span>{doc.fileName || doc.title}</span>
                <Icon name="chevron" size={14} />
              </button>
            ))}
          </div>
        </section>
      )}

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

      {reviewIndex !== null && draft && draft.questions[reviewIndex] && (
        <QuestionReviewModal
          question={draft.questions[reviewIndex]}
          index={reviewIndex}
          onClose={() => setReviewIndex(null)}
          onDelete={() => {
            setDraft((current) => current ? { ...current, questions: current.questions.filter((_, i) => i !== reviewIndex) } : current)
            setReviewIndex(null)
          }}
          onSave={(next) => {
            setDraft((current) => current ? {
              ...current,
              questions: current.questions.map((q, i) => i === reviewIndex ? next : q),
            } : current)
            setConfirmedIds((prev) => prev.includes(next.id) ? prev : [...prev, next.id])
            setReviewIndex(null)
          }}
        />
      )}

      {showConfirmPaper && draft && (
        <Modal
          title="确认组卷"
          onClose={() => setShowConfirmPaper(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowConfirmPaper(false)}>再检查一下</button>
              <button className="btn btn-primary" onClick={() => void savePaper()}><Icon name="layers" size={15} /> 确认组卷</button>
            </>
          }
        >
          <div className="op-confirm-summary">
            <div className="op-confirm-row"><span>试卷名称</span><b>{titleInput.trim() || draft.fileName.replace(/\.[^.]+$/, '')}</b></div>
            <div className="op-confirm-row"><span>题目总数</span><b>{draft.questions.length} 题</b></div>
            <div className="op-confirm-row"><span>已校对确认</span><b className="ok">{draft.questions.length - pendingCount} 题</b></div>
            <div className="op-confirm-row"><span>拆题方式</span><b>{draft.usedLlm ? '大模型智能拆题 + 规则校验' : '规则拆题'}</b></div>
            {pendingCount > 0 && (
              <div className="op-flag"><Icon name="info" size={14} /> 还有 {pendingCount} 道题未校对确认，组卷后仍可在刷题页发现并修正。建议先逐题校对。</div>
            )}
            <p className="muted small" style={{ margin: '12px 0 0' }}>确认后该试卷将保存，可无限次刷题；答错的题会自动加入错题库。</p>
          </div>
        </Modal>
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
