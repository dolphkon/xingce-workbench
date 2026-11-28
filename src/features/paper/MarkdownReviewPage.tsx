import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '../../components/ui'
import SymbolPicker from '../../components/SymbolPicker'
import { extractMarkdownImages, ruleMarkdownToQuestions } from '../../lib/markdownFlow'
import {
  formatExamTemplate, pageEditorBody, parseExamTemplate, templateStats, updateTemplatePage,
} from '../../lib/examTemplate'
import type { LlmBlockReason } from '../../lib/llm'

export interface MarkdownDraftState {
  markdown: string
  fileName: string
  fileType: string
  fileData: string
  defaultTitle: string
  usedLlm: boolean
  llmReason?: LlmBlockReason
  llmMessage?: string
  textMethod: string
  usedOcr: boolean
  /** 逐页原文（OCR 时按真实页边界） */
  pageTexts?: string[]
}

/** 图片最长边上限：超出时按比例缩放，不拉伸、不裁剪 */
const MAX_IMAGE_SIDE = 1600
const PAGE_BATCH = 3

function imageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
        const context = canvas.getContext('2d')
        if (!context) throw new Error('浏览器不支持画布处理')
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        reject(err)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')) }
    image.src = url
  })
}

/**
 * 套卷模板校验页：按部分 / 按页加载，逐页编辑与预览，
 * 支持符号插入、图片原比例材料、自动排版、全文模式，确认后交阶段②解析成题。
 */
export default function MarkdownReviewPage({
  draft,
  onMarkdownChange,
  onBack,
  onParse,
  parsing,
  onUploadMd,
}: {
  draft: MarkdownDraftState
  onMarkdownChange: (markdown: string) => void
  onBack: () => void
  onParse: () => void
  parsing: boolean
  onUploadMd: (file: File) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pageEditorRef = useRef<HTMLTextAreaElement>(null)
  const fullEditorRef = useRef<HTMLTextAreaElement>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const [imageError, setImageError] = useState('')
  const [selectedPage, setSelectedPage] = useState(1)
  const [visiblePages, setVisiblePages] = useState(PAGE_BATCH)
  const [loadingPage, setLoadingPage] = useState(false)
  const [fullMode, setFullMode] = useState(false)

  const template = useMemo(() => parseExamTemplate(draft.markdown), [draft.markdown])
  const stats = useMemo(() => templateStats(draft.markdown), [draft.markdown])
  const page = template.pages.find((item) => item.no === selectedPage) ?? template.pages[0]
  const pageText = pageEditorBody(page)
  const pageQuestions = useMemo(() => ruleMarkdownToQuestions(page.body), [page.body])
  const editorRef = fullMode ? fullEditorRef : pageEditorRef
  const currentText = fullMode ? draft.markdown : pageText

  const writeText = (value: string) => {
    if (fullMode) onMarkdownChange(value)
    else onMarkdownChange(updateTemplatePage(draft.markdown, page.no, value))
  }

  /** 在当前编辑器光标处插入文本 */
  const insertAtCursor = (value: string) => {
    const editor = editorRef.current
    if (!editor) { writeText(`${currentText}${value}`); return }
    const start = editor.selectionStart ?? currentText.length
    const end = editor.selectionEnd ?? start
    writeText(`${currentText.slice(0, start)}${value}${currentText.slice(end)}`)
    requestAnimationFrame(() => {
      editor.focus()
      const cursor = start + value.length
      editor.setSelectionRange(cursor, cursor)
    })
  }

  /** 光标所在题块「材料：」行末；找不到时挂到当前页第一个材料行 */
  const materialLineEnd = (text: string, cursor: number): number | null => {
    const before = text.slice(0, cursor)
    const blockStart = Math.max(before.lastIndexOf('\n#### 第'), before.lastIndexOf('\n## 第'), before.lastIndexOf('#### 第'), before.lastIndexOf('## 第'))
    const after = text.slice(cursor)
    const nextBlock = after.search(/\n#{2,4}\s*第?\s*\d{1,3}\s*题/)
    const end = cursor + (nextBlock < 0 ? after.length : nextBlock)
    const block = text.slice(Math.max(0, blockStart), end)
    const match = block.match(/^[ \t]*(?:[-*][ \t]*)?材料[ \t]*[:：][^\n]*/m)
    if (match && match.index !== undefined) return Math.max(0, blockStart) + match.index + match[0].length
    const fallback = text.match(/^[ \t]*(?:[-*][ \t]*)?材料[ \t]*[:：][^\n]*/m)
    return fallback && fallback.index !== undefined ? fallback.index + fallback[0].length : null
  }

  const insertImage = async (file: File | undefined) => {
    if (!file) return
    setImageError('')
    try {
      const dataUrl = await imageToDataUrl(file)
      const imageMarkdown = `![材料图](${dataUrl})`
      const editor = editorRef.current
      const target = materialLineEnd(currentText, editor?.selectionStart ?? currentText.length)
      insertAtCursor(target === null ? `\n${imageMarkdown}\n` : ` ${imageMarkdown}`)
    } catch (err) {
      setImageError(err instanceof Error ? err.message : '图片插入失败')
    }
  }

  const selectPage = (no: number) => {
    if (no === selectedPage) return
    setLoadingPage(true)
    setSelectedPage(no)
    if (no > visiblePages) setVisiblePages(no)
    window.setTimeout(() => setLoadingPage(false), 220)
  }

  const download = () => {
    const blob = new Blob([draft.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${draft.defaultTitle || '试卷'}-套卷模板.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft.markdown)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch { /* 剪贴板不可用时静默 */ }
  }

  const importMd = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) onUploadMd(file)
    event.target.value = ''
  }

  const pageImages = extractMarkdownImages(page.body).images
  const hiddenPages = template.pages.length - Math.min(visiblePages, template.pages.length)
  // 按页加载是全局的：多个部分时不能每部分各自显示前 N 页
  const loadedPageNos = new Set(template.pages.slice(0, visiblePages).map((item) => item.no))
  const groupedPages = template.sections.length
    ? template.sections.map((section) => ({ section, pages: template.pages.filter((p) => p.section === section && loadedPageNos.has(p.no)) }))
    : [{ section: '整卷题目', pages: template.pages.filter((p) => loadedPageNos.has(p.no)) }]

  return (
    <div className="md-review">
      <div className="md-review-head">
        <div>
          <h2>阶段① · 套卷模板校验（按页加载）</h2>
          <p className="muted small">
            {draft.usedLlm ? 'AI 已按套卷模板整理' : '规则生成（当前环境 AI 未启用）'} · {draft.textMethod}
            {draft.usedOcr ? ' + OCR 回退' : ''} · {stats.sections} 个部分 / {stats.pages} 页 / <b>{stats.questions}</b> 道题
          </p>
        </div>
        <button className="btn" onClick={onBack}><Icon name="back" size={15} /> 返回</button>
      </div>

      {!draft.usedLlm && draft.llmMessage && (
        <div className="op-notice warn"><Icon name="info" size={15} /> {draft.llmMessage}。你仍可校验下面的模板并继续生成题目。</div>
      )}

      <div className="md-review-tip">
        <Icon name="info" size={15} />
        <span>
          模板按<strong>部分 → 页 → 题</strong>固定分层，模拟真实试卷逐页加载。左侧选择页码，右侧编辑该页并可预览卷面；
          支持插入 <code>①②③</code> 符号与图形材料截图，改完点「确认排版」由 AI 按模板组合成套卷。
        </span>
        <button className="btn btn-sm" onClick={() => setShowHelp((v) => !v)}>{showHelp ? '收起格式说明' : '查看格式说明'}</button>
      </div>

      {showHelp && (
        <div className="md-review-help">
          <div className="md-help-title">套卷固定模板（字段顺序固定）</div>
          <pre>{`# 试卷名称（可选）

## 第一部分 言语理解与表达
### 第 1 页
#### 第 3 题
题型：单选题
模块：言语理解
材料：设问前的背景材料（可留空；图形题可写 ![图形材料](图片地址)）
题干：以下对应表述正确的有：

A. 选项正文
B. 选项正文
C. 选项正文
D. 选项正文
答案：B
解析：解析原文（没有可删掉此行）

### 第 2 页
#### 第 4 题
...`}</pre>
          <ul>
            <li>层级固定：<code>## 第X部分</code> → <code>### 第 N 页</code> → <code>#### 第 N 题</code>；旧格式 <code>## 第 N 题</code> 自动识别为第 1 页。</li>
            <li>题内字段顺序：题型 → 模块 → 材料 → 题干 → 选项 → 答案 → 解析；<code>题干：</code> 必须写出。</li>
            <li>材料可为空或含图片；图片按<strong>原始宽高比</strong>显示，符号用工具栏在光标处插入。</li>
            <li>选项支持 <code>A. XXX</code> / <code>1. XXX</code> / <code>① XXX</code>，按出现顺序对应四个选项。</li>
          </ul>
        </div>
      )}

      <div className="md-review-toolbar">
        <div className="md-review-actions">
          <SymbolPicker onPick={insertAtCursor} title="在光标处插入符号（如 ①②③、⑴、1.）" />
          <button className="btn btn-sm" onClick={() => imageInputRef.current?.click()} title="插入图形材料截图，按原比例显示"><Icon name="image" size={14} /> 插入图片</button>
          <button className="btn btn-sm" onClick={() => onMarkdownChange(formatExamTemplate(draft.markdown))} title="按套卷模板重排字段与分页"><Icon name="layers" size={14} /> 自动排版</button>
          <button className="btn btn-sm" onClick={download}><Icon name="download" size={14} /> 下载 .md</button>
          <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={14} /> 上传 .md 续改</button>
          <button className="btn btn-sm" onClick={() => void copy()}><Icon name="copy" size={14} /> {copied ? '已复制' : '复制'}</button>
          <button className="btn btn-sm" onClick={() => setFullMode((v) => !v)}>{fullMode ? '返回分页视图' : '全文视图'}</button>
          <input ref={fileInputRef} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onChange={importMd} />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => { void insertImage(event.target.files?.[0]); event.target.value = '' }}
          />
        </div>
        <span className="md-review-count">共 {draft.markdown.length} 字符 · {stats.questions} 道题</span>
      </div>
      {imageError && <div className="error-text">{imageError}</div>}

      {fullMode ? (
        <div className="mdt-full">
          <textarea
            ref={fullEditorRef}
            className="md-review-editor"
            value={draft.markdown}
            onChange={(e) => onMarkdownChange(e.target.value)}
            onPaste={(event) => {
              const imageItem = Array.from(event.clipboardData?.items ?? [])
                .find((item) => item.type.startsWith('image/'))
              if (!imageItem) return
              event.preventDefault()
              void insertImage(imageItem.getAsFile() ?? undefined)
            }}
            spellCheck={false}
            aria-label="套卷模板全文编辑器"
          />
        </div>
      ) : (
        <div className="mdt-layout">
          <aside className="mdt-sidebar">
            <div className="mdt-sidebar-head">
              <Icon name="filetext" size={14} /> 试卷目录
              <span className="muted small">已加载 {Math.min(visiblePages, template.pages.length)}/{template.pages.length} 页</span>
            </div>
            {groupedPages.map((group) => (
              <div className="mdt-section" key={group.section}>
                <div className="mdt-section-title">{group.section}</div>
                {group.pages.slice(0, visiblePages).map((item) => (
                  <button
                    type="button"
                    key={item.no}
                    className={`mdt-page-tab${item.no === page.no ? ' active' : ''}`}
                    onClick={() => selectPage(item.no)}
                  >
                    <span>第 {item.no} 页</span>
                    <span className="muted small">{item.questionIndexes.length} 题</span>
                  </button>
                ))}
              </div>
            ))}
            {hiddenPages > 0 && (
              <button className="btn btn-sm mdt-load-more" onClick={() => setVisiblePages((n) => n + PAGE_BATCH)}>
                <Icon name="chevron" size={14} /> 加载下一页（还有 {hiddenPages} 页）
              </button>
            )}
          </aside>

          <main className="mdt-main">
            <div className="mdt-page-head">
              <div>
                <b>第 {page.no} 页</b>
                <span className="muted small"> · {page.section || '整卷题目'} · {pageQuestions.length} 道题</span>
              </div>
              <div className="mdt-page-nav">
                <button className="btn btn-sm" disabled={page.no <= template.pages[0].no} onClick={() => selectPage(page.no - 1)}>上一页</button>
                <button className="btn btn-sm" disabled={page.no >= template.pages[template.pages.length - 1].no} onClick={() => selectPage(page.no + 1)}>下一页</button>
              </div>
            </div>

            {loadingPage ? (
              <div className="mdt-loading"><span className="mdt-spinner" /> 正在加载第 {selectedPage} 页…</div>
            ) : (
              <>
                <textarea
                  ref={pageEditorRef}
                  className="mdt-page-editor"
                  value={pageText}
                  onChange={(e) => writeText(e.target.value)}
                  onPaste={(event) => {
                    const imageItem = Array.from(event.clipboardData?.items ?? [])
                      .find((item) => item.type.startsWith('image/'))
                    if (!imageItem) return
                    event.preventDefault()
                    void insertImage(imageItem.getAsFile() ?? undefined)
                  }}
                  spellCheck={false}
                  aria-label={`第 ${page.no} 页模板编辑器`}
                />

                <div className="mdt-paper-preview">
                  <div className="mdt-paper-head">试卷预览 · 第 {page.no} 页</div>
                  {pageQuestions.length === 0 ? (
                    <p className="muted small">本页暂无题目。</p>
                  ) : pageQuestions.map((question, index) => {
                    const [material, stem] = question.title.includes('【题目】')
                      ? question.title.split('【题目】').map((part) => part.replace(/^【共用材料】/, '').trim())
                      : ['', question.title]
                    return (
                      <div className="mdt-paper-q" key={question.id}>
                        <div className="mdt-paper-q-head">
                          <b>{index + 1}.</b> {stem}
                          <span className="muted small">（{question.type}）</span>
                        </div>
                        {material && <div className="mdt-paper-material">{material}</div>}
                        <div className="mdt-paper-options">
                          {question.options.filter((option) => option.trim()).map((option, i) => (
                            <span key={i}>{String.fromCharCode(65 + i)}. {option}</span>
                          ))}
                        </div>
                        <div className="mdt-paper-answer">答案：{question.answer || '—'}</div>
                      </div>
                    )
                  })}
                </div>

                {pageImages.length > 0 && (
                  <div className="md-material-preview">
                    <div className="md-material-preview-head"><Icon name="image" size={14} /> 本页材料图片（原始宽高比，点击放大）</div>
                    <div className="md-material-images">
                      {pageImages.map((src, index) => (
                        <button type="button" className="md-material-image" key={index} onClick={() => setZoomSrc(src)}>
                          <img src={src} alt={`第 ${page.no} 页材料 ${index + 1}`} />
                          <span>第 {page.no} 页 · 材料 {index + 1}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      )}

      <div className="md-review-footer">
        <span className="muted small">修改会自动保存；确认后 AI 按套卷模板解析成题目，仍可逐题校对修正。</span>
        <button className="btn btn-primary" onClick={onParse} disabled={parsing || stats.questions === 0}>
          <Icon name="brain" size={16} /> {parsing ? '解析中…' : `确认排版，解析为 ${stats.questions} 道题`}
        </button>
      </div>

      {zoomSrc && (
        <div className="md-image-lightbox" onClick={() => setZoomSrc(null)} role="dialog" aria-label="材料图片放大预览">
          <img src={zoomSrc} alt="材料图片放大预览" />
          <button className="btn" onClick={() => setZoomSrc(null)}>关闭</button>
        </div>
      )}
    </div>
  )
}
