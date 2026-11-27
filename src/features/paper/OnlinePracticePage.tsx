import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog, Icon, Modal } from '../../components/ui'
import { useCollection } from '../../lib/hooks'
import { put, readCachedAll, remove } from '../../lib/db'
import { loadDocFile } from '../../lib/docFile'
import { LLM_AVAILABLE } from '../../lib/llm'
import {
  formatStem, inspectQuestion, parseDocumentToQuestions, parseFileKind, type ParseProgress,
} from '../../lib/paperParser'
import { dateKey, formatClock, uid } from '../../lib/utils'
import type { KnowledgeDoc, Mistake, Paper, PracticeRecord, QuizQuestion } from '../../types'
import PaperExamRunner, { type ExamResult } from './PaperExamRunner'

type View = 'list' | 'upload' | 'exam'

/** 把题干拆成「共用材料 / 题目正文」两段，便于清晰排版 */
function splitStem(title: string): { material: string; stem: string } {
  const parts = title.split('【题目】')
  if (parts.length === 2) {
    return { material: parts[0].replace(/^【共用材料】/, '').trim(), stem: parts[1].trim() }
  }
  return { material: '', stem: title.trim() }
}

/** 单题人工审核弹窗：题干、选项、答案均可编辑并即时校验 */
function QuestionReviewModal({
  question, index, onSave, onDelete, onClose,
}: {
  question: QuizQuestion
  index: number
  onSave: (next: QuizQuestion) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(question.title)
  const [options, setOptions] = useState<string[]>(() => [0, 1, 2, 3].map((i) => question.options[i] ?? ''))
  const [answer, setAnswer] = useState(question.answer)
  const [analysis, setAnalysis] = useState(question.analysis)
  const [type, setType] = useState(question.type)
  const confidence = inspectQuestion(question)

  const answerValid = answer.trim() === '' || /^[A-Da-d]{1,4}$/.test(answer.replace(/[\s、,，]/g, '').toUpperCase())
  const canSave = title.trim().length > 0 && answerValid

  const save = () => {
    if (!canSave) return
    onSave({
      ...question,
      title: formatStem(title),
      options: options.map((option) => option.trim()),
      answer: answer.replace(/[\s、,，]/g, '').toUpperCase(),
      analysis: analysis.trim(),
      type: type.trim() || '其他',
    })
  }

  return (
    <Modal
      title={`审核第 ${index + 1} 题`}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn op-delete" onClick={onDelete} style={{ marginRight: 'auto' }}><Icon name="trash" size={14} /> 删除此题</button>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={save} disabled={!canSave}><Icon name="save" size={15} /> 保存修改</button>
        </>
      }
    >
      <div className="op-review-form">
        {confidence.needsReview && (
          <div className="op-flag">
            <Icon name="info" size={14} />
            {confidence.tooLongStem ? '题干过长，疑似多题粘连，请拆分确认' : confidence.missingAnswer ? '答案未识别，请人工填写' : '选项识别不完整，请核对'}
          </div>
        )}
        <label className="form-label">题干 / 材料（换行会保留）</label>
        <textarea className="input op-textarea" rows={6} value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="form-label">选项</label>
        {options.map((option, i) => (
          <div className="op-option-edit" key={i}>
            <span className="op-option-key">{String.fromCharCode(65 + i)}</span>
            <input className="input" value={option} onChange={(e) => setOptions((prev) => prev.map((v, j) => j === i ? e.target.value : v))} placeholder={`选项 ${String.fromCharCode(65 + i)}`} />
          </div>
        ))}
        <div className="op-form-row">
          <div>
            <label className="form-label">正确答案（A-D，多选如 AB）</label>
            <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="如 A / AB" />
            {!answerValid && <p className="op-field-error">答案只能是 A-D 字母</p>}
          </div>
          <div>
            <label className="form-label">题型 / 模块</label>
            <input className="input" value={type} onChange={(e) => setType(e.target.value)} placeholder="如 言语理解" />
          </div>
        </div>
        <label className="form-label">解析（可选）</label>
        <textarea className="input op-textarea" rows={3} value={analysis} onChange={(e) => setAnalysis(e.target.value)} />
      </div>
    </Modal>
  )
}

/** 在线刷题：上传 PDF/Word → 多方式识别成卷 → 类专项刷题 → 错题入库 → 历史记录 */
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
  const [draft, setDraft] = useState<{ questions: QuizQuestion[]; method: string; fileName: string; fileType: string; fileData: string } | null>(null)
  const [parseError, setParseError] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [confirmDeletePaper, setConfirmDeletePaper] = useState<Paper | null>(null)

  useEffect(() => { refreshPapers(); refreshRecords() }, [])

  const handleFile = async (file: File) => {
    setParseError('')
    setDraft(null)
    setReviewIndex(null)
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
      setDraft({
        questions: result.questions,
        method: result.method,
        fileName: file.name,
        fileType: file.type || `application/${file.name.split('.').pop()}`,
        fileData,
      })
      setTitleInput(loaded.title)
      setView('upload')
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
    setDraft(null)
    setView('list')
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
          reviewStatus: 'new',
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
    // 从知识库文档进入：直接触发解析
    void (async () => {
      setUploading(true)
      setProgress({ percent: 5, stage: 'prepare', message: '正在读取知识库文档…' })
      try {
        if (!doc.fileData) throw new Error('文档内容为空')
        const result = await parseDocumentToQuestions(doc.fileData, doc.fileName || doc.title, doc.fileType || '', setProgress)
        setDraft({
          questions: result.questions, method: result.method,
          fileName: doc.fileName || doc.title,
          fileType: doc.fileType || '',
          fileData: doc.fileData,
        })
        setTitleInput(doc.title)
        setView('upload')
      } catch (err) {
        setParseError(err instanceof Error ? err.message : '解析失败')
      } finally {
        setUploading(false)
      }
    })()
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

  return (
    <div className="page online-practice-page">
      <div className="page-head">
        <div>
          <h1>在线刷题</h1>
          <p className="muted">上传 PDF 或 Word 文档，识别解析成在线试卷。同一文档可反复练习，答错的题自动进入错题库。</p>
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

      {!LLM_AVAILABLE && (
        <div className="op-notice">
          <Icon name="info" size={15} /> 当前域名使用「文本提取 + 规则切题」识别；在 WorkBuddy 应用中打开可启用大模型智能拆题，准确率更高。
        </div>
      )}

      {parseError && <div className="error-text op-error">{parseError}</div>}

      {uploading && (
        <div className="op-progress">
          <div className="op-progress-bar"><span style={{ width: `${progress.percent}%` }} /></div>
          <div className="op-progress-text">{progress.message} · {progress.percent}%</div>
        </div>
      )}

      {view === 'upload' && draft && !uploading && (
        <div className="op-review">
          <div className="op-review-head">
            <div>
              <h2>解析完成 · {draft.questions.length} 道题</h2>
              <p className="muted small">识别方式：{draft.method}</p>
            </div>
            <button className="btn" onClick={() => { setDraft(null); setView('list') }}><Icon name="back" size={15} /> 返回</button>
          </div>
          <div className="form-field">
            <label className="form-label">试卷名称</label>
            <input className="input" value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="给这份试卷起个名字" />
          </div>
          {(() => {
            const pending = draft.questions
              .map((q, i) => ({ q, i, c: inspectQuestion(q) }))
              .filter((item) => item.c.needsReview)
            return pending.length > 0 ? (
              <div className="op-review-tip">
                <Icon name="info" size={15} />
                <span>有 <b>{pending.length}</b> 道题识别结果不确定（答案未识别 / 选项不全 / 题干疑似粘连），建议逐题审核后再保存。</span>
                <button className="btn btn-sm" onClick={() => setReviewIndex(pending[0].i)}>审核第 {pending[0].i + 1} 题</button>
              </div>
            ) : (
              <div className="op-review-tip ok"><Icon name="check" size={15} /> 所有题目识别完整，可直接保存；也可以点每道题的「编辑」微调。</div>
            )
          })()}
          <div className="op-review-list">
            {draft.questions.map((question, index) => {
              const confidence = inspectQuestion(question)
              const parsed = splitStem(question.title)
              const filled = question.options.map((option, i) => ({ option, i })).filter((item) => item.option.trim())
              return (
                <div className={`op-review-item${confidence.needsReview ? ' pending' : ''}`} key={question.id}>
                  <div className="op-review-item-head">
                    <span className="op-q-index">第 {index + 1} 题</span>
                    {confidence.needsReview && <span className="op-pending-flag">待审核</span>}
                    <button className="btn btn-sm" onClick={() => setReviewIndex(index)}><Icon name="edit" size={14} /> 编辑</button>
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
                    )) : <span className="muted">（未识别到选项，请编辑补充）</span>}
                  </div>
                  <div className={`op-review-answer${confidence.missingAnswer ? ' missing' : ''}`}>
                    正确答案：<b>{question.answer || '未识别 · 请编辑填写'}</b>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="op-review-actions">
            <button className="btn" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={15} /> 重新上传</button>
            <button className="btn btn-primary" onClick={() => void savePaper()}><Icon name="save" size={16} /> 保存为试卷</button>
          </div>
        </div>
      )}

      <section className="op-section">
        <div className="op-section-head">
          <h2>我的试卷 <span className="op-count">{papers.length}</span></h2>
        </div>
        {papers.length === 0 ? (
          <div className="op-empty">
            <Icon name="filetext" size={30} />
            <p>还没有试卷。上传一份 PDF 或 Word 文档开始吧。</p>
            <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={15} /> 上传文档</button>
          </div>
        ) : (
          <div className="op-paper-grid">
            {papers.map((paper) => {
              const paperRecords = historyFor(paper.id)
              const last = paperRecords[0]
              return (
                <div className="op-paper-card" key={paper.id}>
                  <div className="op-paper-icon"><Icon name="filetext" size={22} /></div>
                  <div className="op-paper-main">
                    <div className="op-paper-title">{paper.title}</div>
                    <div className="op-paper-meta muted small">
                      {paper.questionCount} 道题 · {paper.fileName}
                      {last && ` · 最近 ${dateKey(new Date(last.finishedAt))}`}
                    </div>
                    {paper.parseMethod && <div className="op-paper-method small">识别：{paper.parseMethod}</div>}
                  </div>
                  <div className="op-paper-actions">
                    <button className="btn btn-primary btn-sm" onClick={() => startExam(paper)}><Icon name="play" size={14} /> 开始刷题</button>
                    <button className="btn btn-sm" onClick={() => setHistoryPaperId(paper.id)}><Icon name="clock" size={14} /> 历史 {paperRecords.length}</button>
                    <button className="btn btn-sm op-delete" onClick={() => setConfirmDeletePaper(paper)} title="删除试卷"><Icon name="trash" size={14} /></button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

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
            setReviewIndex(null)
          }}
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
            refreshPapers(); refreshRecords(); setConfirmDeletePaper(null)
          })()}
        />
      )}
    </div>
  )
}
