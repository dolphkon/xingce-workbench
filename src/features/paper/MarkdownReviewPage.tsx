import { useRef, useState, type ChangeEvent } from 'react'
import { Icon } from '../../components/ui'
import SymbolPicker from '../../components/SymbolPicker'
import { extractMarkdownImages, splitMarkdownBlocks } from '../../lib/markdownFlow'
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
}

/** 图片最长边上限：超出时按比例缩放，不拉伸、不裁剪，保证材料图形清晰 */
const MAX_IMAGE_SIDE = 1600

/** 读取图片并按原始宽高比生成 DataURL（截图/图形推理材料用） */
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
 * 两阶段拆题中间页：展示 AI 生成的结构化 Markdown，
 * 人工直接编辑排版（拆粘连、改题号、调整选项）、插入符号与图片，下载备份/上传续改，
 * 确认后再解析成题目。
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
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [copied, setCopied] = useState(false)
  const [zoomSrc, setZoomSrc] = useState<string | null>(null)
  const [imageError, setImageError] = useState('')
  const blocks = splitMarkdownBlocks(draft.markdown)

  /** 在编辑器指定位置（默认光标处）插入文本并恢复焦点 */
  const insertAtCursor = (value: string, position?: number) => {
    const editor = editorRef.current
    if (!editor && position === undefined) { onMarkdownChange(`${draft.markdown}${value}`); return }
    const start = position ?? editor?.selectionStart ?? draft.markdown.length
    const end = position === undefined ? (editor?.selectionEnd ?? start) : start
    const next = `${draft.markdown.slice(0, start)}${value}${draft.markdown.slice(end)}`
    onMarkdownChange(next)
    requestAnimationFrame(() => {
      editor?.focus()
      const cursor = start + value.length
      editor?.setSelectionRange(cursor, cursor)
    })
  }

  /** 光标所在题块的「材料：」行末位置；找不到时返回 null */
  const materialLineEnd = (markdown: string, cursor: number): number | null => {
    const before = markdown.slice(0, cursor)
    const after = markdown.slice(cursor)
    const blockStart = Math.max(before.lastIndexOf('\n## 第'), before.lastIndexOf('## 第'))
    const nextBlock = after.indexOf('\n## 第')
    const end = cursor + (nextBlock < 0 ? after.length : nextBlock)
    const block = markdown.slice(Math.max(0, blockStart), end)
    const match = block.match(/^[ \t]*(?:[-*][ \t]*)?材料[ \t]*[:：][^\n]*/m)
    if (match && match.index !== undefined) return Math.max(0, blockStart) + match.index + match[0].length
    // 光标在题块外（如文档开头）时，挂到全篇第一个题块的「材料：」行
    const fallback = markdown.match(/^[ \t]*(?:[-*][ \t]*)?材料[ \t]*[:：][^\n]*/m)
    if (fallback && fallback.index !== undefined) return fallback.index + fallback[0].length
    return null
  }

  const insertImage = async (file: File | undefined) => {
    if (!file) return
    setImageError('')
    try {
      const dataUrl = await imageToDataUrl(file)
      const imageMarkdown = `![材料图](${dataUrl})`
      const editor = editorRef.current
      const target = materialLineEnd(draft.markdown, editor?.selectionStart ?? draft.markdown.length)
      // 光标落在题块内时优先挂到「材料：」行，保证解析后进入题目材料字段
      insertAtCursor(target === null ? imageMarkdown : ` ${imageMarkdown}`, target ?? undefined)
    } catch (err) {
      setImageError(err instanceof Error ? err.message : '图片插入失败')
    }
  }

  const download = () => {
    const blob = new Blob([draft.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${draft.defaultTitle || '试卷'}-拆题中间稿.md`
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

  // 材料图片预览：扫描整个题块（材料行/题干行均可），按原始宽高比显示，点击放大
  const materialImages = blocks.flatMap((block) =>
    extractMarkdownImages(block.body).images.map((src) => ({ no: block.no, src })),
  )

  return (
    <div className="md-review">
      <div className="md-review-head">
        <div>
          <h2>阶段① · Markdown 中间稿校验</h2>
          <p className="muted small">
            {draft.usedLlm ? 'AI 已按规则整理排版' : '规则生成（当前环境 AI 未启用）'} · {draft.textMethod}
            {draft.usedOcr ? ' + OCR 回退' : ''} · 检测到 <b>{blocks.length}</b> 道题
          </p>
        </div>
        <button className="btn" onClick={onBack}><Icon name="back" size={15} /> 返回</button>
      </div>

      {!draft.usedLlm && draft.llmMessage && (
        <div className="op-notice warn"><Icon name="info" size={15} /> {draft.llmMessage}。你仍可校验下面的 Markdown 并继续生成题目。</div>
      )}

      <div className="md-review-tip">
        <Icon name="info" size={15} />
        <span>
          这是<strong>可编辑的中间稿</strong>。请检查每道题是否独立成块、题号是否正确、材料/题干/选项是否分行、水印页码是否清除。
          发现问题可直接在下方修改（例如把粘在一起的两题拆成两个 <code>## 第 N 题</code> 块），
          <strong>材料可留空，也可粘贴图形截图</strong>，<code>①②③</code> 等符号可用工具栏插入，确认无误后再解析成题目。
        </span>
        <button className="btn btn-sm" onClick={() => setShowHelp((v) => !v)}>{showHelp ? '收起格式说明' : '查看格式说明'}</button>
      </div>

      {showHelp && (
        <div className="md-review-help">
          <div className="md-help-title">Markdown 格式约定（字段顺序固定）</div>
          <pre>{`# 试卷名称（可选）

## 第 3 题
题型：单选题
模块：言语理解
材料：设问前的背景材料（可留空；图形题可写 ![图形材料](图片地址)）
题干：以下对应表述正确的有：

A. 选项正文
B. 选项正文
C. 选项正文
D. 选项正文
答案：B
解析：解析原文（没有可删掉此行）`}</pre>
          <ul>
            <li>每道题必须以 <code>## 第 N 题</code> 开头，题号用原文编号（可从 42 开始、可重置为 2）。</li>
            <li>字段顺序：题号 → 题型 → 模块 → 材料 → 题干 → 选项 → 答案 → 解析；<code>题干：</code> 必须写出。</li>
            <li>材料可以为空；图形推理等材料请粘贴截图或上传图片，会按<strong>原始宽高比</strong>显示，不会拉伸变形。</li>
            <li>材料/题干中的 <code>①②③</code>、<code>⑴</code>、<code>1.</code> 等符号按原样保留，用工具栏「符号」在光标处插入。</li>
            <li>选项支持 <code>A. XXX</code>，也支持 <code>1. XXX</code> / <code>① XXX</code> / <code>（1）XXX</code>，按出现顺序对应四个选项。</li>
          </ul>
        </div>
      )}

      <div className="md-review-toolbar">
        <div className="md-review-actions">
          <SymbolPicker onPick={insertAtCursor} title="在光标处插入符号（如 ①②③、⑴、1.）" />
          <button className="btn btn-sm" onClick={() => imageInputRef.current?.click()} title="插入图形材料截图，按原比例显示"><Icon name="image" size={14} /> 插入图片</button>
          <button className="btn btn-sm" onClick={download}><Icon name="download" size={14} /> 下载 .md</button>
          <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}><Icon name="upload" size={14} /> 上传 .md 续改</button>
          <button className="btn btn-sm" onClick={() => void copy()}><Icon name="copy" size={14} /> {copied ? '已复制' : '复制'}</button>
          <input ref={fileInputRef} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onChange={importMd} />
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => { void insertImage(event.target.files?.[0]); event.target.value = '' }}
          />
        </div>
        <span className="md-review-count">共 {draft.markdown.length} 字符 · {blocks.length} 个题块</span>
      </div>
      {imageError && <div className="error-text">{imageError}</div>}

      <textarea
        ref={editorRef}
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
        aria-label="Markdown 中间稿编辑器"
      />

      {materialImages.length > 0 && (
        <div className="md-material-preview">
          <div className="md-material-preview-head">
            <Icon name="image" size={14} /> 材料图片预览（原始宽高比，点击放大）
          </div>
          <div className="md-material-images">
            {materialImages.map((item, index) => (
              <button
                type="button"
                className="md-material-image"
                key={`${item.no}-${index}`}
                onClick={() => setZoomSrc(item.src)}
                title={`第 ${item.no} 题材料图片，点击放大`}
              >
                <img src={item.src} alt={`第 ${item.no} 题材料`} />
                <span>第 {item.no} 题</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="md-review-footer">
        <span className="muted small">修改会自动保存；解析后进入逐题校对，可继续逐题修正。编辑器支持直接粘贴图片截图。</span>
        <button className="btn btn-primary" onClick={onParse} disabled={parsing || blocks.length === 0}>
          <Icon name="brain" size={16} /> {parsing ? '解析中…' : `确认排版，解析为 ${blocks.length} 道题`}
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
