import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog, EmptyState, Icon, Modal } from '../../components/ui'
import QuestionImages from '../../components/QuestionImages'
import { put, remove } from '../../lib/db'
import { useCollection } from '../../lib/hooks'
import { parseImagesToBank, type BankParseProgress } from '../../lib/bankParser'
import { compressImage, fileToDataUrl } from '../../lib/image'
import { richHtmlForPreview, richTextToPlain } from '../../lib/richText'
import { formatQuestionText, pluralDays } from '../../lib/utils'
import { BANK_CATEGORIES, BANK_MODULES, type BankQuestion } from '../../types'
import BankForm from './BankForm'
import AnswerManager from './AnswerManager'
import SmartComposePanel from './SmartComposePanel'
import DocumentToPaperFlow from '../paper/DocumentToPaperFlow'

interface DraftImage { stored: string; ocr: string }

export default function QuestionBankPage() {
  const navigate = useNavigate()
  const { items, error, refresh } = useCollection('bank')
  const { items: mistakes } = useCollection('mistakes')
  const [keyword, setKeyword] = useState('')
  const [moduleFilter, setModuleFilter] = useState<string>('全部')
  const [categoryFilter, setCategoryFilter] = useState<string>('全部')
  const [editing, setEditing] = useState<BankQuestion | 'new' | null>(null)
  const [deleting, setDeleting] = useState<BankQuestion | null>(null)
  const [jsonView, setJsonView] = useState<BankQuestion | null>(null)
  // 文档转在线刷题：占用整页，与题库列表互斥
  const [docFlowOpen, setDocFlowOpen] = useState(false)
  const [answerManagerOpen, setAnswerManagerOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)

  // 图片识别弹窗
  const [importOpen, setImportOpen] = useState(false)
  const [draftImages, setDraftImages] = useState<DraftImage[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseProgress, setParseProgress] = useState<BankParseProgress>({ percent: 0, stage: '' })
  const [parsedQuestions, setParsedQuestions] = useState<BankQuestion[]>([])
  const [parseMeta, setParseMeta] = useState<{ usedLlm: boolean; method: string; message: string } | null>(null)
  const [parseError, setParseError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  // ref 镜像：粘贴是异步压缩后再入列，用 ref 读取最新批次，避免闭包拿到旧 state
  const draftImagesRef = useRef<DraftImage[]>([])
  const parsingRef = useRef(false)
  const pasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filtered = useMemo(() => items.filter((item) => {
    if (moduleFilter !== '全部' && item.module !== moduleFilter) return false
    if (categoryFilter !== '全部' && item.category !== categoryFilter) return false
    if (keyword.trim()) {
      const text = `${richTextToPlain(item.materialHtml || item.material)} ${item.stem} ${item.options.join(' ')} ${item.answer} ${item.source ?? ''}`.toLowerCase()
      if (!text.includes(keyword.trim().toLowerCase())) return false
    }
    return true
  }).sort((a, b) => b.createdAt - a.createdAt), [items, keyword, moduleFilter, categoryFilter])

  /** 统一更新待识别图片：同时同步 state 与 ref */
  const applyDraft = (next: DraftImage[]) => {
    draftImagesRef.current = next
    setDraftImages(next)
  }

  // 把一批图片文件压缩后加入待识别列表，返回合并后的最新批次
  const addImageFiles = async (files: File[]): Promise<DraftImage[]> => {
    const [stored, originals] = await Promise.all([
      Promise.all(files.map((f) => compressImage(f))),
      Promise.all(files.map((f) => fileToDataUrl(f).catch(() => ''))),
    ])
    const added = stored.map((s, i) => ({ stored: s, ocr: originals[i] || s }))
    const next = [...draftImagesRef.current, ...added].slice(0, 12)
    applyDraft(next)
    setParsedQuestions([])
    setParseError('')
    return next
  }

  const handleAddImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    try {
      await addImageFiles(files)
    } catch {
      setParseError('图片读取失败')
    }
    event.target.value = ''
  }

  const runParse = useCallback(async (batch?: DraftImage[]) => {
    const images = batch ?? draftImagesRef.current
    if (!images.length || parsingRef.current) return
    parsingRef.current = true
    setParsing(true)
    setParseError('')
    setParsedQuestions([])
    setParseMeta(null)
    try {
      const result = await parseImagesToBank(images, (p) => setParseProgress(p))
      setParsedQuestions(result.questions)
      setParseMeta({ usedLlm: result.usedLlm, method: result.method, message: result.message })
    } catch (err) {
      setParseError(err instanceof Error ? err.message : '识别失败')
    } finally {
      parsingRef.current = false
      setParsing(false)
    }
  }, [])

  // 粘贴自动识别：弹窗打开时监听 document，剪贴板含图片则入列，防抖后自动开始识别。
  // 连续粘贴多张截图时只触发一次识别，避免重复调用大模型。
  useEffect(() => {
    if (!importOpen) return
    const onPaste = (event: ClipboardEvent) => {
      if (parsingRef.current) return
      const items = Array.from(event.clipboardData?.items ?? [])
      const files = items
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      if (!files.length) return
      event.preventDefault()
      setParseProgress({ percent: 0, stage: '正在读取粘贴图片…' })
      void addImageFiles(files).then((next) => {
        if (pasteTimerRef.current) clearTimeout(pasteTimerRef.current)
        pasteTimerRef.current = setTimeout(() => {
          pasteTimerRef.current = null
          void runParse(next)
        }, 500)
      }).catch(() => setParseError('图片读取失败'))
    }
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('paste', onPaste)
      if (pasteTimerRef.current) { clearTimeout(pasteTimerRef.current); pasteTimerRef.current = null }
    }
  }, [importOpen, runParse])

  const saveParsed = async () => {
    if (!parsedQuestions.length) return
    try {
      await Promise.all(parsedQuestions.map((q) => put('bank', q)))
      refresh()
      setImportOpen(false)
      applyDraft([])
      setParsedQuestions([])
      setParseMeta(null)
    } catch {
      setParseError('入库失败，请重试')
    }
  }

  const openImport = () => {
    setImportOpen(true)
    applyDraft([])
    setParsedQuestions([])
    setParseMeta(null)
    setParseError('')
    setParseProgress({ percent: 0, stage: '' })
  }

  const pushToMistake = (question: BankQuestion) => {
    // 通过查询参数把题库题目 id 传给错题库，错题页读取后打开预填表单
    navigate(`/mistakes?fromBank=${encodeURIComponent(question.id)}`)
  }

  const exportJson = () => {
    const data = JSON.stringify(parsedQuestions.length ? parsedQuestions : filtered, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `题库导出-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (docFlowOpen) {
    return (
      <DocumentToPaperFlow
        onBack={() => setDocFlowOpen(false)}
        onPushed={(paper) => navigate('/online-practice', { state: { activePaperId: paper.id } })}
      />
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">题库管理</h1>
          <p className="page-subtitle">图片识别拆题按 JSON 结构化入库；也可上传 PDF / Word 生成套卷，逐题校对后人工推送到在线刷题</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={exportJson}><Icon name="download" size={16} /> 导出 JSON</button>
          <button className="btn" onClick={() => setAnswerManagerOpen(true)}><Icon name="check" size={16} /> 答案管理</button>
          <button className="btn" onClick={() => setComposeOpen(true)}><Icon name="layers" size={16} /> 智能组卷</button>
          <button className="btn" onClick={() => setDocFlowOpen(true)}><Icon name="filetext" size={16} /> 文档转在线刷题</button>
          <button className="btn btn-primary" onClick={openImport}><Icon name="sparkle" size={16} /> 图片识别入库</button>
          <button className="btn" onClick={() => setEditing('new')}><Icon name="plus" size={16} /> 手动新增</button>
        </div>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="filter-bar">
        <div className="search-box">
          <Icon name="search" size={15} />
          <input className="input" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索题干、材料、答案…" />
        </div>
        <select className="select" style={{ width: 'auto', minWidth: 130 }} value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} title="按模块筛选">
          <option value="全部">全部模块</option>
          {BANK_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="select" style={{ width: 'auto', minWidth: 120 }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} title="按类别筛选">
          <option value="全部">全部类别</option>
          {BANK_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="spacer" />
        <span className="small muted">共 {filtered.length} 道</span>
      </div>

      <div className="card">
        <div className="card-body tight">
          {filtered.length === 0 ? (
            <EmptyState
              icon="layers"
              title="题库还是空的"
              description="上传题目图片批量识别入库，或手动新增一道题"
              action={<button className="btn btn-primary" onClick={openImport}><Icon name="sparkle" size={15} /> 图片识别入库</button>}
            />
          ) : (
            <div className="bank-list">
              {filtered.map((item) => (
                <div className="bank-item" key={item.id}>
                  <div className="bank-item-head">
                    <span className={`chip ${item.category === '多选题' ? 'chip-warning' : 'chip-primary'}`}>{item.category}</span>
                    <span className="chip">{item.module}</span>
                    {item.answer && <span className="chip chip-success">答案 {item.answer}</span>}
                    {item.images.length > 0 && <span className="chip"><Icon name="image" size={11} /> {item.images.length}</span>}
                    <span className="bank-item-id" title={item.id}>ID {item.id.slice(0, 8)}…</span>
                    <span className="small light">{pluralDays(item.createdAt)}</span>
                  </div>
                  {item.materialHtml ? (
                    <div className="bank-item-material-rich" dangerouslySetInnerHTML={{ __html: richHtmlForPreview(item.materialHtml) }} />
                  ) : item.material ? (
                    <div className="bank-item-material">{formatQuestionText(item.material).replace(/\n/g, ' ').slice(0, 160)}</div>
                  ) : null}
                  <div className="bank-item-stem">{formatQuestionText(item.stem).replace(/\n/g, ' ')}</div>
                  <div className="bank-item-options">
                    {item.options.map((opt, i) => opt ? <span key={i}>{String.fromCharCode(65 + i)}. {opt}</span> : null)}
                  </div>
                  <div className="bank-item-actions">
                    <button className="btn btn-sm btn-primary" onClick={() => pushToMistake(item)}><Icon name="target" size={13} /> 推送到错题</button>
                    <button className="btn btn-sm" onClick={() => setJsonView(item)}><Icon name="filetext" size={13} /> 查看 JSON</button>
                    <button className="icon-btn" title="编辑" onClick={() => setEditing(item)}><Icon name="edit" size={16} /></button>
                    <button className="icon-btn danger" title="删除" onClick={() => setDeleting(item)}><Icon name="trash" size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 图片识别入库弹窗 */}
      {importOpen && (
        <Modal
          title="图片识别入库"
          onClose={() => { if (!parsing) setImportOpen(false) }}
          wide
          footer={
            <>
              <button className="btn" onClick={() => setImportOpen(false)} disabled={parsing}>取消</button>
              <button className="btn btn-primary" onClick={() => void runParse()} disabled={parsing || draftImages.length === 0}>
                <Icon name="sparkle" size={15} /> {parsing ? '识别中…' : '开始识别'}
              </button>
              <button className="btn btn-primary" onClick={() => void saveParsed()} disabled={parsing || parsedQuestions.length === 0}>
                <Icon name="save" size={15} /> 确认入库（{parsedQuestions.length}）
              </button>
            </>
          }
        >
          <p className="small muted" style={{ marginTop: 0 }}>
            支持多张题目截图，识别后逐题拆为 JSON（唯一 ID / 类别 / 模块 / 材料 / 题干 / 选项），校对无误后确认入库。
          </p>

          <div className="form-field">
            <label className="form-label">题目图片（最多 12 张）</label>
            <label className="upload-zone">
              <Icon name="image" size={22} />
              <div style={{ marginTop: 6 }}>点击选择图片，或直接 Ctrl / ⌘ + V 粘贴截图</div>
              <div className="small light" style={{ marginTop: 4 }}>粘贴后自动开始识别，可连续粘贴多张</div>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={(e) => void handleAddImages(e)} disabled={parsing} />
            </label>
            {draftImages.length > 0 && (
              <QuestionImages
                images={draftImages.map((d) => d.stored)}
                altPrefix="待识别"
                variant="thumb"
                renderActions={(index) => (
                  <button type="button" className="icon-btn danger" style={{ background: 'rgba(255,255,255,.92)' }} onClick={() => applyDraft(draftImagesRef.current.filter((_, i) => i !== index))} disabled={parsing} aria-label="移除图片">
                    <Icon name="trash" size={13} />
                  </button>
                )}
              />
            )}
          </div>

          {parsing && (
            <div className="ocr-status" style={{ marginTop: 10 }}>
              <Icon name="sparkle" size={15} />
              <span>{parseProgress.stage || '正在识别'} {parseProgress.percent}%</span>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${parseProgress.percent}%` }} /></div>
            </div>
          )}
          {parseError && <div className="error-banner">{parseError}</div>}
          {parseMeta && (
            <div className="notice" style={{ fontSize: 'calc(12px * var(--font-scale))' }}>
              <Icon name={parseMeta.usedLlm ? 'sparkle' : 'bolt'} size={13} /> {parseMeta.method}：{parseMeta.message}。共拆出 {parsedQuestions.length} 道题。
            </div>
          )}

          {parsedQuestions.length > 0 && (
            <div className="bank-preview-list">
              <div className="bank-preview-title">识别结果预览（入库后可在列表中编辑）</div>
              {parsedQuestions.map((q, i) => (
                <div className="bank-preview-item" key={q.id}>
                  <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                    <span className="chip chip-primary">{i + 1}</span>
                    <span className={`chip ${q.category === '多选题' ? 'chip-warning' : ''}`}>{q.category}</span>
                    <span className="chip">{q.module}</span>
                    {q.answer && <span className="chip chip-success">答案 {q.answer}</span>}
                  </div>
                  {q.material && <div className="small muted">{q.material.slice(0, 80)}…</div>}
                  <div>{q.stem.slice(0, 120)}{q.stem.length > 120 ? '…' : ''}</div>
                  <div className="small light">{q.options.filter(Boolean).join(' / ')}</div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* 手动新增/编辑 */}
      {editing && (
        <Modal title={editing === 'new' ? '新增题库题目' : '编辑题库题目'} onClose={() => setEditing(null)} wide>
          <BankForm
            initial={editing === 'new' ? undefined : editing}
            onSaved={async (q) => { await put('bank', q); setEditing(null); refresh() }}
            onCancel={() => setEditing(null)}
          />
        </Modal>
      )}

      {/* JSON 查看 */}
      {jsonView && (
        <Modal title="题目 JSON" onClose={() => setJsonView(null)} footer={<button className="btn" onClick={() => setJsonView(null)}>关闭</button>}>
          <pre className="bank-json-view">{JSON.stringify(jsonView, null, 2)}</pre>
        </Modal>
      )}

      {composeOpen && (
        <SmartComposePanel
          bank={items}
          mistakes={mistakes}
          onClose={() => setComposeOpen(false)}
          onComposed={(paper) => navigate('/online-practice', { state: { activePaperId: paper.id } })}
        />
      )}

      {answerManagerOpen && (
        <AnswerManager
          title="题库答案管理"
          targets={items.map((item) => ({ id: item.id, no: item.no, title: item.stem, answer: item.answer }))}
          onClose={() => setAnswerManagerOpen(false)}
          onApply={async (answers) => {
            const now = Date.now()
            await Promise.all(items.map((item) => answers[item.id] === undefined
              ? Promise.resolve()
              : put('bank', { ...item, answer: answers[item.id], updatedAt: now })))
            refresh()
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          message={`确定删除这道题吗？「${deleting.stem.slice(0, 40)}${deleting.stem.length > 40 ? '…' : ''}」`}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => { await remove('bank', deleting.id); setDeleting(null); refresh() }}
        />
      )}
    </>
  )
}
