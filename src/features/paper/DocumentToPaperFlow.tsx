import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog, Icon, Modal } from '../../components/ui'
import CircularProgress from '../../components/CircularProgress'
import { useCollection } from '../../lib/hooks'
import { put } from '../../lib/db'
import { loadDocFile } from '../../lib/docFile'
import {
  probeLlm, structureTemplateFill, type LlmBlockReason, type LlmProbe, type LlmProgress,
} from '../../lib/llm'
import {
  extractDocumentText, parseDocumentToQuestions, parseFileKind, type ParseProgress,
} from '../../lib/paperParser'
import {
  applyTemplateFill, buildTemplateDraft, draftToQuestions, markdownToDraft, type TemplateDraft,
} from '../../lib/templateDraft'
import { bankQuestionToQuiz, quizToBankQuestion, syncPaperToBank } from '../../lib/bankSync'
import { uid } from '../../lib/utils'
import type { BankQuestion, KnowledgeDoc, Paper, QuizQuestion } from '../../types'
import BankForm from '../bank/BankForm'
import PaperQuestionCard from './PaperQuestionCard'
import QuestionReviewModal from './QuestionReviewModal'
import TemplateEditorPage from './TemplateEditorPage'

type View = 'template' | 'review' | null

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

interface Props {
  onBack: () => void
  onPushed: (paper: Paper) => void
}

const llmProgress = (progress: LlmProgress): ParseProgress => ({
  percent: Math.max(1, Math.min(99, Math.round(progress.fraction * 100))),
  stage: 'llm',
  message: progress.message,
})

/**
 * 文档转在线刷题：文档 → 题号锚点生成结构化模版 → AI 回填题槽字段 →
 * 结构化编辑器人工校对 → 生成套卷 → 逐题校对 / JSON / 编辑题库 → 人工推送。
 */
export default function DocumentToPaperFlow({ onBack, onPushed }: Props) {
  const { items: docs } = useCollection('docs')
  const [view, setView] = useState<View>(null)
  const [uploading, setUploading] = useState(false)
  const [refilling, setRefilling] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState<ParseProgress>({ percent: 0, stage: 'prepare', message: '' })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null)
  const [parseError, setParseError] = useState('')
  const [titleInput, setTitleInput] = useState('')
  const [reviewIndex, setReviewIndex] = useState<number | null>(null)
  const [confirmedIds, setConfirmedIds] = useState<string[]>([])
  const [showConfirmPush, setShowConfirmPush] = useState(false)
  // 推送时同步写入在线题库，后续可按模块组卷与批量导入答案
  const [syncToBank, setSyncToBank] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [llmProbe, setLlmProbe] = useState<LlmProbe | null>(null)
  const [jsonIndex, setJsonIndex] = useState<number | null>(null)
  const [editingBank, setEditingBank] = useState<{ index: number; initial: BankQuestion } | null>(null)
  const [confirmDelQ, setConfirmDelQ] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const directInputRef = useRef<HTMLInputElement>(null)

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
    setView('review')
  }

  /** AI 只回填题槽字段，不改变题块边界 */
  const refillTemplate = async (base: TemplateDraft) => {
    setRefilling(true)
    setParseError('')
    try {
      const fills = await structureTemplateFill(base.rawText, undefined, (p) => setProgress(llmProgress(p)))
      setTemplateDraft((current) => current && current.questions === base.questions
        ? applyTemplateFill(current, fills)
        : current)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI 填充失败'
      setTemplateDraft((current) => current ? { ...current, llmMessage: message } : current)
    } finally {
      setRefilling(false)
    }
  }

  const openTemplate = (extracted: Awaited<ReturnType<typeof extractDocumentText>>, meta: {
    title: string; fileName: string; fileType: string; fileData: string
  }) => {
    const template = buildTemplateDraft({
      text: extracted.text,
      pageTexts: extracted.pageTexts,
      title: meta.title,
      fileName: meta.fileName,
      fileType: meta.fileType,
      fileData: meta.fileData,
      textMethod: extracted.textMethod,
      usedOcr: extracted.usedOcr,
    })
    setTemplateDraft(template)
    setTitleInput(meta.title || meta.fileName.replace(/\.[^.]+$/, ''))
    setDraft(null)
    setConfirmedIds([])
    setParseError('')
    setView('template')
    if (llmProbe?.available) void refillTemplate(template)
    else setTemplateDraft((current) => current ? { ...current, llmMessage: llmProbe?.message } : current)
  }

  const handleFile = async (file: File) => {
    setParseError('')
    setDraft(null)
    setTemplateDraft(null)
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

  /** 新流程入口：提取文档 → 原文题号生成结构化模版（随后 AI 回填字段） */
  const handleFileTwoStage = async (file: File) => {
    setParseError('')
    setDraft(null)
    setTemplateDraft(null)
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
      const extracted = await extractDocumentText(fileData, file.name, file.type, setProgress)
      openTemplate(extracted, {
        title: loaded.title,
        fileName: file.name,
        fileType: file.type || `application/${file.name.split('.').pop()}`,
        fileData,
      })
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '解析失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  /** 结构化题槽 → 待确认题目，直接生成套卷，不再二次解析 Markdown */
  const generatePaper = () => {
    if (!templateDraft) return
    setGenerating(true)
    try {
      const questions = draftToQuestions(templateDraft)
      setDraft({
        questions,
        method: `${templateDraft.textMethod} + ${templateDraft.usedLlm ? 'AI 字段填充' : '规则字段'} + 结构化模版 + 人工校对`,
        fileName: templateDraft.fileName,
        fileType: templateDraft.fileType || `application/${templateDraft.fileName.split('.').pop()}`,
        fileData: templateDraft.fileData,
        usedLlm: templateDraft.usedLlm,
        llmMessage: templateDraft.llmMessage,
      })
      setTitleInput(templateDraft.title || titleInput)
      setConfirmedIds([])
      setView('review')
    } finally {
      setGenerating(false)
    }
  }

  const uploadMarkdownFile = async (file: File) => {
    try {
      const text = await file.text()
      if (!text.trim()) throw new Error('Markdown 文件为空')
      const template = markdownToDraft(text, templateDraft ?? {})
      if (!template.questions.length) throw new Error('Markdown 中没有识别到题块')
      setTemplateDraft(template)
      setTitleInput(template.title || template.fileName || titleInput)
      setParseError('')
      setView('template')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Markdown 文件读取失败')
    }
  }

  /** 人工确认推送：保存为在线试卷 */
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
    if (syncToBank) {
      setSyncing(true)
      try {
        await syncPaperToBank(paper)
      } finally {
        setSyncing(false)
      }
    }
    setDraft(null)
    setTemplateDraft(null)
    setConfirmedIds([])
    setShowConfirmPush(false)
    setView(null)
    onPushed(paper)
  }

  const openFromKnowledgeDoc = (doc: KnowledgeDoc) => {
    void (async () => {
      setUploading(true)
      setProgress({ percent: 5, stage: 'prepare', message: '正在读取知识库文档…' })
      try {
        if (!doc.fileData) throw new Error('文档内容为空')
        const fileName = doc.fileName || doc.title
        const fileType = doc.fileType || ''
        const extracted = await extractDocumentText(doc.fileData, fileName, fileType, setProgress)
        openTemplate(extracted, { title: doc.title, fileName, fileType, fileData: doc.fileData })
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

  const pendingCount = draft ? draft.questions.filter((q) => !confirmedIds.includes(q.id)).length : 0
  const docFiles = docs.filter((doc) => doc.kind === 'file' && /\.(pdf|docx)$/i.test(doc.fileName || ''))

  return (
    <div className="page document-to-paper-page">
      <div className="page-head">
        <div>
          <h1>文档转在线刷题</h1>
          <p className="muted">上传 PDF / Word → 按原文题号生成结构化套卷模版 → AI 回填字段 → 人工校对生成套卷并推送。</p>
        </div>
        <div className="op-head-actions">
          <button className="btn" onClick={onBack}><Icon name="back" size={15} /> 返回题库管理</button>
          <button className="btn" onClick={() => directInputRef.current?.click()} disabled={uploading} title="跳过模版编辑，直接拆题（适合排版规整的文档）">
            <Icon name="bolt" size={15} /> 直接拆题
          </button>
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            <Icon name="upload" size={16} /> {uploading ? '解析中…' : '上传文档'}
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFileTwoStage(file)
            event.target.value = ''
          }}
        />
        <input
          ref={directInputRef}
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

      {llmProbe ? (
        <div className={`op-notice${llmProbe.available ? ' ok' : ' warn'}`}>
          <Icon name={llmProbe.available ? 'check' : 'info'} size={15} />
          {llmProbe.available
            ? '大模型已就绪：上传后按原文题号生成题槽，AI 逐题回填字段；题块边界始终来自原文，不会被模型合并。'
            : `${llmProbe.message} 将用规则拆题并填好字段，仍可人工校对并生成套卷。`}
        </div>
      ) : (
        <div className="op-notice"><Icon name="info" size={15} /> 正在检测智能拆题能力…</div>
      )}

      {parseError && <div className="error-text op-error">{parseError}</div>}
      {(uploading || refilling || generating) && <CircularProgress progress={progress} />}

      {view === null && !uploading && (
        <div className="card paper-flow-intro">
          <div className="card-body">
            <div className="paper-flow-steps">
              <span><b>1</b> 上传文档 / 选择知识库文档</span>
              <span><b>2</b> 原文题号生成结构化模版 + AI 填充</span>
              <span><b>3</b> 逐题校对、查看 JSON、编辑题库</span>
              <span><b>4</b> 人工推送到在线刷题</span>
            </div>
            <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={15} /> 选择 PDF / Word 文档</button>
          </div>
        </div>
      )}

      {view === 'template' && templateDraft && !uploading && (
        <TemplateEditorPage
          draft={templateDraft}
          onChange={setTemplateDraft}
          onBack={() => { setTemplateDraft(null); setView(null) }}
          onGenerate={generatePaper}
          generating={generating}
          onRefill={() => void refillTemplate(templateDraft)}
          refilling={refilling}
          onUploadMd={(file) => void uploadMarkdownFile(file)}
        />
      )}

      {view === 'review' && draft && !uploading && (
        <div className="card paper-review-page">
          <div className="card-body">
            <div className="paper-review-head">
              <div>
                <h2>套卷已生成 · {draft.questions.length} 道题</h2>
                <p className="muted small">拆题方式：{draft.method}</p>
              </div>
              <button className="btn" onClick={() => { setDraft(null); setTemplateDraft(null); setView('template') }}><Icon name="back" size={15} /> 返回模版编辑</button>
            </div>
            <div className="form-field">
              <label className="form-label">试卷名称</label>
              <input className="input" value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="给这份套卷起个名字" />
            </div>
            <div className={`op-review-tip${pendingCount === 0 ? ' ok' : ''}`}>
              <Icon name={pendingCount === 0 ? 'check' : 'info'} size={15} />
              {pendingCount === 0
                ? <>全部 <b>{draft.questions.length}</b> 道题已完成校对，可推送到在线刷题。</>
                : <>还有 <b>{pendingCount}</b> 道题未确认。可逐题「校对」核对题干、选项与答案，或点「确认无误」快速通过；也可「编辑题库」保存为题库题目。</>}
            </div>
            <div className="bank-list paper-review-list">
              {draft.questions.map((question, index) => (
                <PaperQuestionCard
                  key={question.id}
                  question={question}
                  index={index}
                  confirmed={confirmedIds.includes(question.id)}
                  onConfirm={() => markConfirmed(index)}
                  onReview={() => setReviewIndex(index)}
                  onViewJson={() => setJsonIndex(index)}
                  onEditBank={() => setEditingBank({ index, initial: quizToBankQuestion(question) })}
                  onDelete={() => setConfirmDelQ(index)}
                />
              ))}
            </div>
            <div className="paper-review-actions">
              <button className="btn" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={15} /> 重新上传</button>
              <button className="btn" onClick={() => { setDraft(null); setTemplateDraft(null); setView(null) }}><Icon name="back" size={15} /> 返回题库</button>
              <button className="btn btn-primary" onClick={() => setShowConfirmPush(true)} disabled={!draft.questions.length}>
                <Icon name="play" size={16} /> 推送到在线刷题
              </button>
            </div>
          </div>
        </div>
      )}

      {docFiles.length > 0 && view === null && !uploading && (
        <section className="op-section">
          <div className="op-section-head"><h2>从知识库文档创建</h2></div>
          <div className="op-doc-list">
            {docFiles.map((doc) => (
              <button className="op-doc-row" key={doc.id} onClick={() => openFromKnowledgeDoc(doc)} disabled={uploading}>
                <Icon name="filetext" size={16} />
                <span>{doc.fileName || doc.title}</span>
                <Icon name="chevron" size={14} />
              </button>
            ))}
          </div>
        </section>
      )}

      {reviewIndex !== null && draft?.questions[reviewIndex] && (
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

      {jsonIndex !== null && draft?.questions[jsonIndex] && (
        <Modal title={`第 ${jsonIndex + 1} 题 JSON`} onClose={() => setJsonIndex(null)} footer={<button className="btn" onClick={() => setJsonIndex(null)}>关闭</button>}>
          <pre className="bank-json-view">{JSON.stringify(draft.questions[jsonIndex], null, 2)}</pre>
        </Modal>
      )}

      {editingBank && (
        <Modal title={`编辑题库 · 第 ${editingBank.index + 1} 题`} onClose={() => setEditingBank(null)} wide>
          <BankForm
            initial={editingBank.initial}
            onCancel={() => setEditingBank(null)}
            onSaved={async (q) => {
              await put('bank', q)
              setDraft((current) => current ? {
                ...current,
                questions: current.questions.map((item, i) => i === editingBank.index ? bankQuestionToQuiz(q, item) : item),
              } : current)
              setConfirmedIds((prev) => prev.includes(draft?.questions[editingBank.index].id ?? '') ? prev : [...prev, draft?.questions[editingBank.index].id ?? ''])
              setEditingBank(null)
            }}
          />
        </Modal>
      )}

      {confirmDelQ !== null && (
        <ConfirmDialog
          message={`确定删除第 ${confirmDelQ + 1} 题吗？`}
          onCancel={() => setConfirmDelQ(null)}
          onConfirm={() => {
            setDraft((current) => current ? { ...current, questions: current.questions.filter((_, i) => i !== confirmDelQ) } : current)
            setConfirmDelQ(null)
          }}
        />
      )}

      {showConfirmPush && draft && (
        <Modal
          title="确认组卷并推送到在线刷题"
          onClose={() => setShowConfirmPush(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowConfirmPush(false)}>再检查一下</button>
              <button className="btn btn-primary" onClick={() => void savePaper()} disabled={syncing}><Icon name="play" size={15} /> {syncing ? '正在入库…' : '确认推送'}</button>
            </>
          }
        >
          <div className="op-confirm-summary">
            <div className="op-confirm-row"><span>套卷名称</span><b>{titleInput.trim() || draft.fileName.replace(/\.[^.]+$/, '')}</b></div>
            <div className="op-confirm-row"><span>题目总数</span><b>{draft.questions.length} 题</b></div>
            <div className="op-confirm-row"><span>已校对确认</span><b className="ok">{draft.questions.length - pendingCount} 题</b></div>
            <div className="op-confirm-row"><span>拆题方式</span><b>{draft.usedLlm ? 'AI 字段填充 + 规则题号锚点' : '规则拆题'}</b></div>
            <label className="op-sync-bank">
              <input type="checkbox" checked={syncToBank} onChange={(e) => setSyncToBank(e.target.checked)} />
              <span><b>同步写入在线题库</b>：入库后可在题库管理页按模块组卷、批量导入答案，重复推送不会生成重复题目</span>
            </label>
            {pendingCount > 0 && (
              <div className="op-flag"><Icon name="info" size={14} /> 还有 {pendingCount} 道题未校对确认，推送后仍可在刷题页发现并修正。建议先逐题校对。</div>
            )}
            <p className="muted small" style={{ margin: '12px 0 0' }}>确认后该套卷将保存到在线刷题，可无限次刷题；答错的题会自动加入错题库。</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
