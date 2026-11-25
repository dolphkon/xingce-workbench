import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import type { DocAttachment, DocBlock, BlockType, KnowledgeDoc } from '../../types'
import { escapeHtml, makeBlock } from '../../lib/blocks'
import { formatBytes } from '../../lib/docFile'
import { uid } from '../../lib/utils'
import { Icon } from '../../components/ui'
import ImageLightbox from '../../components/ImageLightbox'
import FileViewer from './FileViewer'

type SlashState = { blockId: string; query: string; left: number; top: number }
type MentionState = { blockId: string; query: string; left: number; top: number }
type ToolbarState = { blockId: string; left: number; top: number }
type SlashItem = { id: string; name: string; icon: string; hint: string; type: BlockType }

/** 插入后需要在下方补一个空文本块的基础块类型（这些块自身不可直接输入文字） */
const TEXT_AFTER_TYPES: BlockType[] = ['code', 'table', 'divider', 'image', 'video', 'link']

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return 0
  const payload = dataUrl.slice(comma + 1)
  if (/;base64/i.test(dataUrl.slice(0, comma))) return Math.floor(payload.replace(/\s/g, '').length * 3 / 4)
  return new TextEncoder().encode(payload).length
}

/** 附件图标：按扩展名给出短标签与配色类 */
function attachmentIcon(name: string, type: string): { label: string; cls: string } {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (ext === 'pdf' || type === 'application/pdf') return { label: 'PDF', cls: 'pdf' }
  if (/ppt|key/.test(ext)) return { label: 'P', cls: 'ppt' }
  if (/doc|pages/.test(ext)) return { label: 'W', cls: 'doc' }
  if (/xls|csv|numbers/.test(ext)) return { label: 'X', cls: 'xls' }
  if (/png|jpe?g|gif|webp|svg|bmp/.test(ext) || type.startsWith('image/')) return { label: '▣', cls: 'img' }
  if (/txt|md|markdown|json|log/.test(ext) || type.startsWith('text/')) return { label: 'T', cls: 'text' }
  return { label: '📎', cls: 'file' }
}

/** 视频地址白名单：外链 / 本地 DataURL / 站内相对路径 */
function safeMediaUrl(url: string): string {
  const value = url.trim()
  return /^(https?:\/\/|data:video\/|\/|\.\/)/i.test(value) ? value : ''
}

/** 常见在线视频地址 → 可内嵌播放地址；其他地址交给 <video> 直接播放 */
function videoEmbedUrl(src: string): string | null {
  const url = src.trim()
  let match = /^https?:\/\/(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([^&#]+)/i.exec(url)
  if (match) return `https://www.youtube.com/embed/${encodeURIComponent(match[1])}`
  match = /^https?:\/\/youtu\.be\/([^?#]+)/i.exec(url)
  if (match) return `https://www.youtube.com/embed/${encodeURIComponent(match[1])}`
  match = /^https?:\/\/(?:www\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]+)/i.exec(url)
  if (match) return `https://player.bilibili.com/player.html?bvid=${encodeURIComponent(match[1])}&page=1&high_quality=1`
  return null
}

/** 本地视频以 Blob URL 播放：避免浏览器反复解码整段 base64 DataURL 造成卡顿 */
function dataVideoToBlobUrl(src: string): string {
  if (!/^data:video\//i.test(src)) return src
  try {
    const comma = src.indexOf(',')
    if (comma < 0) return src
    const meta = src.slice(0, comma)
    const payload = src.slice(comma + 1)
    const mime = /data:([^;,]+)/i.exec(meta)?.[1] || 'video/mp4'
    let bytes: Uint8Array
    if (/;base64/i.test(meta)) {
      const binary = atob(payload.replace(/\s/g, ''))
      bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload))
    }
    return URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: mime }))
  } catch {
    return src
  }
}

/** 独立记忆化组件：编辑其他块时不会重建 <video>，播放进度不受影响 */
const VideoPlayer = memo(function VideoPlayer({ src }: { src: string }) {
  const [playable, setPlayable] = useState(src)
  useEffect(() => {
    const url = dataVideoToBlobUrl(src)
    setPlayable(url)
    return () => { if (url.startsWith('blob:')) URL.revokeObjectURL(url) }
  }, [src])
  return <video src={playable} controls playsInline preload="metadata" />
})

const SLASH_ITEMS: SlashItem[] = [
  { id: 'text', name: '文本', icon: 'T', hint: 'text 正文', type: 'text' },
  { id: 'h1', name: '标题 H1', icon: 'H¹', hint: 'h1 一级标题', type: 'h1' },
  { id: 'h2', name: '标题 H2', icon: 'H²', hint: 'h2 二级标题', type: 'h2' },
  { id: 'h3', name: '标题 H3', icon: 'H³', hint: 'h3 三级标题', type: 'h3' },
  { id: 'todo', name: '待办清单', icon: '☑', hint: 'todo 待办 任务', type: 'todo' },
  { id: 'bullet', name: '无序列表', icon: '•', hint: 'bullet 列表', type: 'bullet' },
  { id: 'number', name: '有序列表', icon: '1.', hint: 'number 编号', type: 'number' },
  { id: 'quote', name: '引用', icon: '❝', hint: 'quote 引用', type: 'quote' },
  { id: 'code', name: '代码块', icon: '</>', hint: 'code 代码', type: 'code' },
  { id: 'table', name: '表格', icon: '▦', hint: 'table 表格', type: 'table' },
  { id: 'divider', name: '分割线', icon: '―', hint: 'divider 分割线', type: 'divider' },
  { id: 'image', name: '插入图片', icon: '▣', hint: 'image 图片', type: 'image' },
  { id: 'video', name: '插入视频', icon: '▶', hint: 'video 视频 播放', type: 'video' },
  { id: 'link', name: '超链接', icon: '↗', hint: 'link 链接', type: 'link' },
  { id: 'attachment', name: '插入文件', icon: '📎', hint: 'file 附件 文件 上传', type: 'attachment' },
]

const CODE_LANGUAGES = ['javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'java', 'go', 'sql']

function getBlockEl(container: HTMLElement | null, id: string): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-block-id="${id}"] .kb-be-content`) ?? null
}

function setCaret(el: HTMLElement, offset: number) {
  try {
    const range = document.createRange()
    const selection = window.getSelection()
    range.setStart(el, Math.min(offset, el.childNodes.length))
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
  } catch {
    // 忽略光标设置失败
  }
}

function textBeforeCaret(el: HTMLElement): string {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return ''
  const caret = selection.getRangeAt(0)
  const range = document.createRange()
  range.selectNodeContents(el)
  range.setEnd(caret.startContainer, caret.startOffset)
  return range.toString()
}

/** 在元素内按「纯文本字符偏移」定位到具体 text node，供 Range 删除 @query 使用 */
function findTextPosition(root: HTMLElement, offset: number): { node: Node; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node: Node | null = null
  while ((node = walker.nextNode())) {
    const len = (node.textContent ?? '').length
    if (remaining <= len) return { node, offset: remaining }
    remaining -= len
  }
  return null
}

function caretRect(): { left: number; bottom: number } {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return { left: 240, bottom: 240 }
  const range = selection.getRangeAt(0).cloneRange()
  range.collapse(false)
  const rects = range.getClientRects()
  const rect = rects.length ? rects[0] : range.getBoundingClientRect()
  return { left: rect.left || 240, bottom: rect.bottom || rect.top + 24 }
}

function highlightCode(code: string, language: string): string {
  const prism = (window as unknown as { Prism?: { languages?: Record<string, unknown>; highlight: (text: string, grammar: unknown, lang: string) => string } }).Prism
  const grammar = prism?.languages?.[language]
  if (prism && grammar) {
    try { return prism.highlight(code, grammar, language) } catch { /* 回退纯文本 */ }
  }
  return escapeHtml(code)
}

function placeholderOf(type: BlockType): string {
  switch (type) {
    case 'h1': return '一级标题'
    case 'h2': return '二级标题'
    case 'h3': return '三级标题'
    case 'todo': return '待办事项'
    case 'bullet': return '列表项'
    case 'number': return '列表项'
    case 'quote': return '引用内容'
    default: return '输入内容，或输入 / 唤出命令'
  }
}

interface BlockItemProps {
  block: DocBlock
  total: number
  docs: KnowledgeDoc[]
  /** 可作为附件引用的文件类文档 */
  fileDocs: KnowledgeDoc[]
  slashActive: boolean
  dragOver: boolean
  onUpdate: (patch: Partial<DocBlock>) => void
  onDelete: () => void
  onInsertAfter: (type?: BlockType) => void
  onEnter: () => void
  onSlash: (state: SlashState | null) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (id: string) => void
  onDrop: (fromId: string, toId: string) => void
  onNavigateDoc: (id: string) => void
  /** 斜杠插入附件后自动展开上传面板 */
  autoOpenAttach: boolean
  /** 附件块未添加任何文件即取消时，交回父级转为空文本块（清除残留的 /） */
  onCancelEmptyAttach: () => void
  /** 打开附件：交给父级在应用内阅读层展示 */
  onOpenFile: (att: DocAttachment) => void
  /** 查看大图：交给父级在灯箱层展示 */
  onOpenImage: (src: string, alt: string) => void
  /** @ 提及菜单状态 */
  onMention: (state: MentionState | null) => void
  mentionActive: boolean
  updateCell: (row: number, col: number, value: string) => void
  addRow: () => void
  addCol: () => void
}

function BlockItem({
  block, total, docs, fileDocs, slashActive, dragOver, onUpdate, onDelete, onInsertAfter, onEnter,
  onSlash, onDragStart, onDragEnd, onDragOver, onDrop, onNavigateDoc,
  autoOpenAttach, onCancelEmptyAttach, onOpenFile, onOpenImage, onMention, mentionActive, updateCell, addRow, addCol,
}: BlockItemProps) {
  const ref = useRef<HTMLDivElement>(null)
  const videoFrameRef = useRef<HTMLDivElement>(null)
  const imgStageRef = useRef<HTMLDivElement>(null)
  const lastHtml = useRef(block.html)
  const mounted = useRef(false)
  const isRich = !['code', 'table', 'divider', 'image', 'video', 'link', 'docref', 'attachment'].includes(block.type)

  const [attachOpen, setAttachOpen] = useState(false)
  const [attachTab, setAttachTab] = useState<'upload' | 'reference'>('upload')
  const [attachError, setAttachError] = useState<string | null>(null)
  const [attachMenu, setAttachMenu] = useState<{ id: string; left: number; top: number } | null>(null)

  const closeAttachPanel = () => {
    setAttachOpen(false)
    // 未添加任何文件即取消 → 交回父级转为空文本块，连同触发的「/」一起清除
    if ((block.attachments ?? []).length === 0) onCancelEmptyAttach()
  }

  const addAttachments = (items: DocAttachment[]) => {
    if (!items.length) return
    // 只更新附件列表，保留块内已输入的说明文字（html/text）
    onUpdate({ attachments: [...(block.attachments ?? []), ...items] })
    setAttachError(null)
    setAttachOpen(false)
  }

  const readFiles = (files: FileList | null) => {
    if (!files || !files.length) return
    const accepted: File[] = []
    for (let i = 0; i < files.length; i += 1) accepted.push(files[i])
    if (!accepted.length) return
    let remaining = accepted.length
    const results: DocAttachment[] = []
    accepted.forEach((file) => {
      const reader = new FileReader()
      reader.onerror = () => { remaining -= 1; if (remaining === 0 && results.length) addAttachments(results) }
      reader.onload = () => {
        results.push({ id: uid(), name: file.name, fileType: file.type || 'application/octet-stream', fileData: String(reader.result), size: file.size })
        remaining -= 1
        if (remaining === 0) addAttachments(results)
      }
      reader.readAsDataURL(file)
    })
    setAttachOpen(false)
  }

  const removeAttachment = (id: string) => {
    const next = (block.attachments ?? []).filter((item) => item.id !== id)
    // 保留说明文字，仅更新附件列表
    onUpdate({ attachments: next })
    setAttachMenu(null)
  }

  const onAttachContext = (event: ReactMouseEvent, id: string) => {
    event.preventDefault()
    setAttachMenu({ id, left: Math.min(event.clientX, window.innerWidth - 130), top: Math.min(event.clientY, window.innerHeight - 90) })
  }

  useEffect(() => {
    if (!attachMenu) return
    const close = () => setAttachMenu(null)
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', onKey) }
  }, [attachMenu])

  // 斜杠插入附件后自动展开面板（面板就出现在原「/」位置）
  useEffect(() => {
    if (autoOpenAttach && block.type === 'attachment') {
      setAttachTab('upload')
      setAttachError(null)
      setAttachOpen(true)
    }
  }, [autoOpenAttach, block.type])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 类型切换（如附件取消后回到文本块）时强制同步 DOM，避免残留上一次的输入
    if (!mounted.current || block.html !== lastHtml.current || el.innerHTML !== block.html) {
      el.innerHTML = block.html
      lastHtml.current = block.html
      mounted.current = true
    }
  }, [block.html, block.type])

  const handleInput = () => {
    const el = ref.current
    if (!el) return
    const text = el.innerText.replace(/\n$/, '')
    const rules: Array<[RegExp, BlockType]> = [
      [/^#\s+(.*)$/, 'h1'],
      [/^##\s+(.*)$/, 'h2'],
      [/^###\s+(.*)$/, 'h3'],
      [/^-\s+(.*)$/, 'bullet'],
      [/^\d+\.\s+(.*)$/, 'number'],
      [/^\[\]\s*(.*)$/, 'todo'],
      [/^```$/, 'code'],
    ]
    // 附件块内的文字是附件说明，不参与 markdown 快捷转换（否则输入「# 」会把附件块变成标题、丢失文件）
    if (block.type !== 'attachment') {
      for (const [pattern, type] of rules) {
        const match = pattern.exec(text)
        if (!match) continue
        const rest = match[1] ?? ''
        el.innerHTML = escapeHtml(rest)
        lastHtml.current = el.innerHTML
        const patch: Partial<DocBlock> = { type, html: el.innerHTML, text: rest }
        if (type === 'todo') patch.checked = false
        if (type === 'code') patch.language = 'javascript'
        onUpdate(patch)
        setCaret(el, 0)
        onSlash(null)
        return
      }
    }
    const html = el.innerHTML
    lastHtml.current = html
    onUpdate({ html, text })

    const before = textBeforeCaret(el)
    const slashMatch = /(?:^|\s)\/([^\s/]*)$/.exec(before)
    if (slashMatch) {
      const rect = caretRect()
      onSlash({
        blockId: block.id,
        query: slashMatch[1].toLowerCase(),
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 320)),
        top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 380)),
      })
      onMention(null)
    } else {
      onSlash(null)
      const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(before)
      if (mentionMatch) {
        const rect = caretRect()
        onMention({
          blockId: block.id,
          query: mentionMatch[1].toLowerCase(),
          left: Math.max(12, Math.min(rect.left, window.innerWidth - 320)),
          top: Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 380)),
        })
      } else {
        onMention(null)
      }
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (slashActive || mentionActive) return
    if (block.type === 'attachment') {
      // 附件块内文字正常编辑：Enter 换行，允许通过「/」「@」唤出命令；不触发块级删除
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onEnter()
    } else if (event.key === 'Backspace' && !ref.current?.innerText && total > 1) {
      event.preventDefault()
      onDelete()
    }
  }

  const renderSpecial = () => {
    if (block.type === 'code') {
      const language = block.language ?? 'javascript'
      return (
        <div className="kb-be-code-block">
          <div className="kb-be-code-head">
            <select className="kb-be-code-lang" value={language} onChange={(e) => onUpdate({ language: e.target.value })}>
              {CODE_LANGUAGES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <span className="kb-be-code-hint">语法高亮由 Prism 提供</span>
          </div>
          <textarea className="kb-be-code-input" value={block.text} spellCheck={false}
            onChange={(e) => onUpdate({ text: e.target.value, html: '' })}
            placeholder="输入代码…" />
          <pre className="kb-be-code-preview"><code className={`language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlightCode(block.text, language) }} /></pre>
        </div>
      )
    }
    if (block.type === 'table') {
      return (
        <div className="kb-be-table-block">
          <table>
            <tbody>
              {(block.rows ?? []).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, colIndex) => (
                    <td key={colIndex} contentEditable suppressContentEditableWarning
                      onBlur={(e) => updateCell(rowIndex, colIndex, e.currentTarget.innerText)}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="kb-be-table-ops"><button onClick={addRow}>+ 行</button><button onClick={addCol}>+ 列</button></div>
        </div>
      )
    }
    if (block.type === 'divider') return <hr className="kb-be-divider" />
    if (block.type === 'image') {
      const src = block.src ?? ''
      const alt = block.text || '图片'
      const width = Math.max(10, Math.min(300, block.imgWidth ?? 100))
      const setWidth = (w: number) => onUpdate({ imgWidth: Math.max(10, Math.min(300, Math.round(w))) })
      const stageRef = imgStageRef
      const startResize = (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const startX = e.clientX
        const startW = width
        const onMove = (ev: MouseEvent) => {
          // 按舞台当前像素宽度换算百分比，保证拖拽直观
          const stagePx = stageRef.current?.clientWidth || 600
          setWidth(startW + ((ev.clientX - startX) / stagePx) * 100)
        }
        const onUp = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }
      return src ? (
        <figure className="kb-be-media kb-be-image">
          <div className="kb-be-image-stage" ref={stageRef} style={{ width: `${width}%` }}>
            <img src={src} alt={alt} title="拖拽右下角调整大小，点击查看大图"
              onClick={() => onOpenImage(src, alt)} />
            <div className="kb-be-image-tools" onClick={(e) => e.stopPropagation()}>
              <button title="缩小" onClick={() => setWidth(width - 10)}>−</button>
              <span>{width}%</span>
              <button title="放大" onClick={() => setWidth(width + 10)}>+</button>
              <button onClick={() => setWidth(100)}>复位</button>
              <button className="primary" onClick={() => onOpenImage(src, alt)}>查看大图</button>
            </div>
            <span className="kb-be-image-resize" title="拖拽调整图片大小" onMouseDown={startResize} />
          </div>
          <figcaption contentEditable suppressContentEditableWarning
            onBlur={(e) => onUpdate({ text: e.currentTarget.innerText })}>{block.text}</figcaption>
        </figure>
      ) : (
        <div className="kb-be-media-empty">
          <input className="kb-be-input" placeholder="粘贴图片 URL" onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) onUpdate({ src: e.currentTarget.value.trim() })
          }} />
          <label className="kb-be-file-btn">或选择本地图片
            <input type="file" accept="image/*" hidden onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => onUpdate({ src: String(reader.result), text: file.name })
              reader.readAsDataURL(file)
            }} />
          </label>
        </div>
      )
    }
    if (block.type === 'video') {
      const src = block.src ?? ''
      const embed = videoEmbedUrl(src)
      const playable = safeMediaUrl(src)
      return src ? (
        <figure className="kb-be-media kb-be-video">
          <div className="kb-be-video-frame" ref={videoFrameRef}>
            {embed ? (
              <iframe src={embed} title={block.text || '在线视频'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            ) : playable ? (
              <VideoPlayer src={playable} />
            ) : (
              <div className="kb-be-video-invalid">视频地址无效，请重新粘贴或选择本地视频</div>
            )}
          </div>
          <div className="kb-be-video-tools">
            <button onClick={() => { if (videoFrameRef.current?.requestFullscreen) void videoFrameRef.current.requestFullscreen() }}>全屏播放</button>
            <span>{block.text || '视频'}</span>
            {(embed || playable) && <a href={embed || playable} target="_blank" rel="noreferrer">新窗口打开</a>}
          </div>
          <figcaption contentEditable suppressContentEditableWarning
            onBlur={(e) => onUpdate({ text: e.currentTarget.innerText })}>{block.text}</figcaption>
        </figure>
      ) : (
        <div className="kb-be-media-empty">
          <input className="kb-be-input" placeholder="粘贴视频 URL（mp4 / YouTube / B站）" onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) onUpdate({ src: e.currentTarget.value.trim(), text: '视频' })
          }} />
          <label className="kb-be-file-btn">或选择本地视频
            <input type="file" accept="video/*" hidden onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const reader = new FileReader()
              reader.onload = () => onUpdate({ src: String(reader.result), text: file.name })
              reader.readAsDataURL(file)
            }} />
          </label>
        </div>
      )
    }
    if (block.type === 'attachment') {
      const attachments = block.attachments ?? []
      return (
        <div className="kb-be-attach-block">
          {attachments.length > 0 && (
            <div className="kb-be-attach-list">
              {attachments.map((att) => {
                const icon = attachmentIcon(att.name, att.fileType)
                return (
                  <div key={att.id} className="kb-be-attach-item" onContextMenu={(e) => onAttachContext(e, att.id)}>
                    <span className={`kb-be-attach-icon ${icon.cls}`}>{icon.label}</span>
                    {/* 单击文件名在应用内在线阅读（PDF/图片/Office/文本等），右键仍可删除 */}
                    <span className="kb-be-attach-name" title={`在线阅读：${att.name}`}
                      onClick={(e) => { e.stopPropagation(); onOpenFile(att) }}>{att.name}</span>
                    <span className="kb-be-attach-size">{formatBytes(att.fileData) || `${Math.round(att.size / 1024)} KB`}</span>
                  </div>
                )
              })}
            </div>
          )}
          {/* 附件说明文字：与文件共存的可编辑区，支持选中文字呼出格式工具栏 */}
          <div
            key={`content-${block.type}`}
            ref={ref}
            className="kb-be-content kb-be-content-attachment"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            data-placeholder={attachments.length ? '输入说明文字，选中可设置格式…' : placeholderOf(block.type)}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
          />
          {/* 已有文件时隐藏「添加附件」入口 */}
          {attachments.length === 0 && (
            <button className="kb-be-attach-add" onClick={() => {
              if (attachOpen) closeAttachPanel()
              else { setAttachTab('upload'); setAttachError(null); setAttachOpen(true) }
            }}>
              ＋ 添加文件
            </button>
          )}

          {attachOpen && (
            <div className="kb-be-attach-panel" onClick={(e) => e.stopPropagation()}>
              <div className="kb-be-attach-tabs">
                <button className={attachTab === 'upload' ? 'active' : ''} onClick={() => { setAttachTab('upload'); setAttachError(null) }}>上传</button>
                <button className={attachTab === 'reference' ? 'active' : ''} onClick={() => { setAttachTab('reference'); setAttachError(null) }}>引用文件</button>
                <button className="kb-be-attach-close" title="取消" onClick={closeAttachPanel}><Icon name="x" size={14} /></button>
              </div>
              {attachTab === 'upload' ? (
                <div className="kb-be-attach-pane">
                  <p className="kb-be-attach-hint">支持多文件；大文件建议压缩以获得更快的同步速度</p>
                  <label className="kb-be-attach-choose">选择文件（支持多选）
                    <input type="file" multiple hidden onChange={(e) => readFiles(e.target.files)} />
                  </label>
                  {attachError && <p className="kb-be-attach-error">{attachError}</p>}
                </div>
              ) : (
                <div className="kb-be-attach-pane">
                  {fileDocs.length === 0
                    ? <p className="kb-be-attach-hint">知识库中暂无文件类文档</p>
                    : (
                      <div className="kb-be-attach-refs">
                        {fileDocs.map((file) => (
                          <button key={file.id} title={file.fileName}
                            onClick={() => {
                              addAttachments([{ id: uid(), name: file.fileName || file.title, fileType: file.fileType || 'application/octet-stream', fileData: file.fileData ?? '', size: dataUrlBytes(file.fileData ?? '') }])
                              setAttachOpen(false)
                            }}>
                            📎 {file.fileName || file.title} <span className="kb-be-attach-size">{formatBytes(file.fileData)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                </div>
              )}
            </div>
          )}

          {attachMenu && (
            <div className="kb-be-attach-menu" style={{ left: attachMenu.left, top: attachMenu.top }}
              onClick={(e) => e.stopPropagation()}>
              <button className="danger" onClick={() => removeAttachment(attachMenu.id)}><Icon name="trash" size={13} /> 删除文件</button>
            </div>
          )}
        </div>
      )
    }
    if (block.type === 'link') {
      return block.href ? (
        <p className="kb-be-link"><a href={block.href} target="_blank" rel="noreferrer">{block.text || block.href}</a></p>
      ) : (
        <div className="kb-be-media-empty">
          <input className="kb-be-input" placeholder="链接文字" data-field="label" />
          <input className="kb-be-input" placeholder="https://example.com" data-field="href"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const container = e.currentTarget.parentElement
              const label = container?.querySelector<HTMLInputElement>('[data-field="label"]')?.value.trim() ?? ''
              const href = e.currentTarget.value.trim()
              if (href) onUpdate({ href, text: label || href })
            }} />
        </div>
      )
    }
    const targetDoc = docs.find((doc) => doc.id === block.docId)
    return (
      <div className="kb-be-docref">
        <select className="kb-be-input" value={block.docId ?? ''} onChange={(e) => onUpdate({ docId: e.target.value })}>
          <option value="">选择文档…</option>
          {docs.map((doc) => <option key={doc.id} value={doc.id}>{doc.title || '无标题'}</option>)}
        </select>
        {targetDoc && <button onClick={() => onNavigateDoc(targetDoc.id)}>打开「{targetDoc.title || '无标题'}」</button>}
      </div>
    )
  }

  return (
    <div className={`kb-be-block kb-be-${block.type}${dragOver ? ' drag-over' : ''}`}
      data-block-id={block.id}
      onDragOver={(e) => { e.preventDefault(); onDragOver(block.id) }}
      onDrop={(e) => { e.preventDefault(); onDrop(e.dataTransfer.getData('text/plain'), block.id) }}>
      <div className="kb-be-gutter">
        <button className="kb-be-handle" draggable title="拖拽排序"
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', block.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(block.id) }}
          onDragEnd={onDragEnd}>⠿</button>
        <button className="kb-be-add" title="在下方插入文本块" onClick={() => onInsertAfter()}>+</button>
      </div>
      <div className="kb-be-main">
        {block.type === 'todo' && (
          <input type="checkbox" className="kb-be-check" checked={Boolean(block.checked)}
            onChange={(e) => onUpdate({ checked: e.target.checked })} />
        )}
        {block.type === 'bullet' && <span className="kb-be-marker">•</span>}
        {block.type === 'number' && <span className="kb-be-marker">1.</span>}
        {block.type === 'quote' && <span className="kb-be-quote-marker" />}
        {isRich ? (
          <div key={`content-${block.type}`} ref={ref} className={`kb-be-content kb-be-content-${block.type}`} contentEditable
            suppressContentEditableWarning spellCheck={false} data-placeholder={placeholderOf(block.type)}
            onInput={handleInput} onKeyDown={handleKeyDown} />
        ) : renderSpecial()}
      </div>
      <button className="kb-be-delete" title="删除块" onClick={onDelete}>×</button>
    </div>
  )
}

interface BlockEditorProps {
  blocks: DocBlock[]
  docs?: KnowledgeDoc[]
  /** 可引用的文件类文档（有 fileData） */
  fileDocs?: KnowledgeDoc[]
  onChangeBlocks: (blocks: DocBlock[]) => void
  onNavigateDoc?: (id: string) => void
}

export default function BlockEditor({ blocks, docs = [], fileDocs = [], onChangeBlocks, onNavigateDoc }: BlockEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // 撤销/重做：历史快照栈；blocksRef 始终指向最新 blocks，避免快速连续操作时闭包读到旧值
  const blocksRef = useRef(blocks)
  blocksRef.current = blocks
  const historyRef = useRef<DocBlock[][]>([])
  const futureRef = useRef<DocBlock[][]>([])
  const lastMergeRef = useRef<string | null>(null)
  const lastCommitAtRef = useRef(0)

  /** 统一提交：记录历史后输出新 blocks。mergeKey 相同且间隔 <800ms 的连续变更合并为一条历史（如打字） */
  const commit = (next: DocBlock[], mergeKey?: string) => {
    const now = Date.now()
    const canMerge = Boolean(mergeKey) && mergeKey === lastMergeRef.current && now - lastCommitAtRef.current < 800
    if (!canMerge) {
      historyRef.current.push(blocksRef.current)
      if (historyRef.current.length > 100) historyRef.current.shift()
    }
    lastMergeRef.current = mergeKey ?? null
    lastCommitAtRef.current = now
    futureRef.current = []
    blocksRef.current = next
    onChangeBlocks(next)
  }

  const undo = () => {
    const prev = historyRef.current.pop()
    if (!prev) return
    futureRef.current.push(blocksRef.current)
    lastMergeRef.current = null
    blocksRef.current = prev
    onChangeBlocks(prev)
  }

  const redo = () => {
    const next = futureRef.current.pop()
    if (!next) return
    historyRef.current.push(blocksRef.current)
    lastMergeRef.current = null
    blocksRef.current = next
    onChangeBlocks(next)
  }

  const [slash, setSlash] = useState<SlashState | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [mention, setMention] = useState<MentionState | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [autoOpenAttachId, setAutoOpenAttachId] = useState<string | null>(null)
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [viewingFile, setViewingFile] = useState<DocAttachment | null>(null)
  const [viewingImage, setViewingImage] = useState<{ src: string; alt: string } | null>(null)

  // @ 提及候选：整个知识库的所有文档（含文件类），按标题/文件夹过滤
  const mentionDocs = useMemo(() => [...docs, ...fileDocs].filter((d, i, arr) => arr.findIndex((x) => x.id === d.id) === i), [docs, fileDocs])
  const filteredMention = useMemo(() => {
    if (!mention) return []
    const q = mention.query.trim().toLowerCase()
    if (!q) return mentionDocs.slice(0, 60)
    return mentionDocs.filter((doc) => `${doc.title} ${doc.fileName ?? ''} ${doc.category}`.toLowerCase().includes(q)).slice(0, 60)
  }, [mention?.query, mentionDocs])

  const filteredSlash = useMemo(() => {
    if (!slash) return []
    const query = slash.query.trim().toLowerCase()
    if (!query) return SLASH_ITEMS
    return SLASH_ITEMS.filter((item) => item.name.toLowerCase().includes(query) || item.hint.toLowerCase().includes(query))
  }, [slash?.query])

  useEffect(() => { setSlashIndex(0) }, [slash?.query])
  useEffect(() => { setMentionIndex(0) }, [mention?.query])

  // 撤销/重做：拦截 Ctrl/Cmd+Z（撤销）、Ctrl/Cmd+Shift+Z 与 Ctrl+Y（重做）
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod || event.key.toLowerCase() !== 'z' && event.key.toLowerCase() !== 'y') return
      const isRedo = event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z')
      event.preventDefault()
      event.stopPropagation()
      setSlash(null)
      setMention(null)
      setToolbar(null)
      if (isRedo) redo(); else undo()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  })

  useEffect(() => {
    if (!slash && !mention) return
    const handler = (event: KeyboardEvent) => {
      if (mention) {
        const max = filteredMention.length
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); event.stopPropagation()
          if (max) setMentionIndex((i) => (i + (event.key === 'ArrowDown' ? 1 : max - 1)) % max)
        } else if (event.key === 'Enter' && max) {
          event.preventDefault(); event.stopPropagation()
          applyMention(filteredMention[Math.min(mentionIndex, max - 1)])
        } else if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation()
          setMention(null)
        }
        return
      }
      if (!slash) return
      const max = filteredSlash.length
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); event.stopPropagation()
        if (max) setSlashIndex((i) => (i + (event.key === 'ArrowDown' ? 1 : max - 1)) % max)
      } else if (event.key === 'Enter' && max) {
        event.preventDefault(); event.stopPropagation()
        applySlashItem(filteredSlash[Math.min(slashIndex, max - 1)])
      } else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        setSlash(null)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  })

  useEffect(() => {
    const handler = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) { setToolbar(null); return }
      const range = selection.getRangeAt(0)
      if (!containerRef.current?.contains(range.commonAncestorContainer)) { setToolbar(null); return }
      let node: Node | null = range.startContainer
      while (node && !(node instanceof HTMLElement && node.dataset.blockId)) node = node.parentNode
      const blockId = node instanceof HTMLElement ? node.dataset.blockId : undefined
      if (!blockId) return
      const rect = range.getBoundingClientRect()
      setToolbar({
        blockId,
        left: Math.max(130, Math.min(rect.left + rect.width / 2, window.innerWidth - 130)),
        top: Math.max(48, rect.top - 6),
      })
    }
    document.addEventListener('selectionchange', handler)
    return () => document.removeEventListener('selectionchange', handler)
  }, [])

  const updateBlock = (id: string, patch: Partial<DocBlock>, mergeKey?: string) => {
    // 仅改 html/text 视为文字编辑，连续输入合并为一条历史；其余（类型/附件/表格等）为结构操作，单独记录
    const keys = Object.keys(patch)
    const textOnly = keys.length > 0 && keys.every((key) => key === 'html' || key === 'text')
    const key = mergeKey ?? (textOnly ? `text:${id}` : undefined)
    commit(blocksRef.current.map((block) => block.id === id ? { ...block, ...patch } : block), key)
  }

  const focusBlock = (id: string) => {
    requestAnimationFrame(() => {
      const el = getBlockEl(containerRef.current, id)
      if (el?.isContentEditable) { el.focus(); setCaret(el, el.childNodes.length) }
    })
  }

  const insertAfter = (id: string, type: BlockType = 'text') => {
    const index = blocksRef.current.findIndex((block) => block.id === id)
    if (index < 0) return
    const block = makeBlock(type)
    const next = [...blocksRef.current]
    next.splice(index + 1, 0, block)
    commit(next)
    focusBlock(block.id)
  }

  const deleteBlock = (id: string) => {
    const index = blocksRef.current.findIndex((block) => block.id === id)
    if (index < 0) return
    if (blocksRef.current.length === 1) { updateBlock(id, { type: 'text', html: '', text: '' }); focusBlock(id); return }
    const next = blocksRef.current.filter((block) => block.id !== id)
    commit(next)
    focusBlock(next[Math.max(0, index - 1)].id)
  }

  const moveBlock = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return
    const next = [...blocksRef.current]
    const from = next.findIndex((block) => block.id === fromId)
    const to = next.findIndex((block) => block.id === toId)
    if (from < 0 || to < 0) return
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    commit(next)
    setDragId(null)
    setDragOverId(null)
  }

  const applySlashItem = (item: SlashItem) => {
    if (!slash) return
    // 先清空 contentEditable 的手动 DOM 内容，避免 React 复用节点时残留「/xxx」文本
    const el = getBlockEl(containerRef.current, slash.blockId)
    if (el) el.innerHTML = ''
    const patch: Partial<DocBlock> = { type: item.type, html: '', text: '' }
    if (item.type === 'todo') patch.checked = false
    if (item.type === 'code') patch.language = 'javascript'
    if (item.type === 'table') patch.rows = [['', ''], ['', '']]
    if (item.type === 'image' || item.type === 'video') patch.src = ''
    if (item.type === 'link') patch.href = ''
    if (item.type === 'docref') patch.docId = docs[0]?.id
    if (item.type === 'attachment') {
      patch.attachments = []
      setAutoOpenAttachId(slash.blockId)
    }
    // 转换块 + 必要时补一个空文本块，合并为一次提交（撤销时整体回退）
    const index = blocksRef.current.findIndex((block) => block.id === slash.blockId)
    const next = blocksRef.current.map((block) => block.id === slash.blockId ? { ...block, ...patch } : block)
    let focusId = slash.blockId
    // 需求2：代码块/表格/分割线/图片/超链接完成后自动在下方加文本行，光标移过去即可输入
    // 附件块自身已带说明文字区，无需再加
    if (index >= 0 && TEXT_AFTER_TYPES.includes(item.type)) {
      const textBlock = makeBlock('text')
      next.splice(index + 1, 0, textBlock)
      focusId = textBlock.id
    }
    commit(next)
    setSlash(null)
    focusBlock(focusId)
  }

  /** 在块的 contentEditable 中把 @query 替换成不可编辑的文档 chip */
  const applyMention = (doc: KnowledgeDoc) => {
    if (!mention) return
    const el = getBlockEl(containerRef.current, mention.blockId)
    const label = doc.title || doc.fileName || '无标题'
    const chip = `<span class="kb-be-mention" contenteditable="false" data-doc-id="${escapeHtml(doc.id)}" title="打开「${escapeHtml(label)}」">📄 ${escapeHtml(label)}</span>`
    if (el) {
      // 用 Range 精确删除光标前的「@query」并插入 chip
      const selection = window.getSelection()
      if (selection && selection.rangeCount) {
        const caret = selection.getRangeAt(0)
        const before = textBeforeCaret(el)
        const atIdx = before.lastIndexOf('@')
        if (atIdx >= 0) {
          const start = findTextPosition(el, atIdx)
          if (start) {
            const range = document.createRange()
            range.setStart(start.node, start.offset)
            range.setEnd(caret.startContainer, caret.startOffset)
            range.deleteContents()
            const frag = range.createContextualFragment(chip + '&nbsp;')
            const last = frag.lastChild
            range.insertNode(frag)
            if (last) {
              const after = document.createRange()
              after.setStartAfter(last)
              after.collapse(true)
              selection.removeAllRanges()
              selection.addRange(after)
            }
          }
        }
      }
      updateBlock(mention.blockId, { html: el.innerHTML, text: el.innerText })
    } else {
      // 无 DOM 时回退为纯文本追加
      const block = blocks.find((b) => b.id === mention.blockId)
      const prev = block?.html ?? ''
      updateBlock(mention.blockId, { html: `${prev.replace(/@[^\s@]*$/, '')}${chip}&nbsp;`, text: '' })
    }
    setMention(null)
    focusBlock(mention.blockId)
  }

  const execFormat = (command: string, value?: string) => {
    if (!toolbar) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    document.execCommand(command, false, value)
    const el = getBlockEl(containerRef.current, toolbar.blockId)
    if (el) updateBlock(toolbar.blockId, { html: el.innerHTML, text: el.innerText })
  }

  const insertInlineCode = () => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return
    const text = selection.toString()
    document.execCommand('insertHTML', false, `<code>${escapeHtml(text)}</code>`)
    if (toolbar) {
      const el = getBlockEl(containerRef.current, toolbar.blockId)
      if (el) updateBlock(toolbar.blockId, { html: el.innerHTML, text: el.innerText })
    }
  }

  return (
    <>
    <div className="kb-be-editor" ref={containerRef} onClick={(event) => {
      if (slash) setSlash(null)
      if (mention) setMention(null)
      // @ 提及 chip 点击 → 打开目标文档（进入新页面）
      const chip = (event.target as HTMLElement).closest?.('[data-doc-id]') as HTMLElement | null
      if (chip?.dataset.docId) { event.preventDefault(); onNavigateDoc?.(chip.dataset.docId) }
    }}>
      {blocks.map((block) => (
        <BlockItem key={block.id} block={block} total={blocks.length} docs={docs} fileDocs={fileDocs}
          slashActive={slash?.blockId === block.id}
          mentionActive={mention?.blockId === block.id}
          autoOpenAttach={autoOpenAttachId === block.id}
          onCancelEmptyAttach={() => {
            const el = getBlockEl(containerRef.current, block.id)
            if (el) el.innerHTML = ''
            updateBlock(block.id, { type: 'text', html: '', text: '', attachments: undefined })
            setAutoOpenAttachId(null)
            focusBlock(block.id)
          }}
          onMention={setMention}
          onOpenFile={(att) => setViewingFile(att)}
          onOpenImage={(src, alt) => setViewingImage({ src, alt })}
          dragOver={dragOverId === block.id && dragId !== block.id}
          onUpdate={(patch) => updateBlock(block.id, patch)}
          onDelete={() => deleteBlock(block.id)}
          onInsertAfter={(type) => insertAfter(block.id, type)}
          onEnter={() => {
            const sameType = block.type === 'todo' || block.type === 'bullet' || block.type === 'number'
            insertAfter(block.id, sameType ? block.type : 'text')
          }}
          onSlash={setSlash}
          onDragStart={setDragId}
          onDragEnd={() => { setDragId(null); setDragOverId(null) }}
          onDragOver={setDragOverId}
          onDrop={moveBlock}
          onNavigateDoc={(docId) => onNavigateDoc?.(docId)}
          updateCell={(row, col, value) => {
            const rows = (block.rows ?? []).map((cells, r) => cells.map((cell, c) => r === row && c === col ? value : cell))
            updateBlock(block.id, { rows })
          }}
          addRow={() => updateBlock(block.id, { rows: [...(block.rows ?? []), ['', '']] })}
          addCol={() => updateBlock(block.id, { rows: (block.rows ?? []).map((row) => [...row, '']) })}
        />
      ))}

      {slash && (
        <div className="kb-be-slash" style={{ left: slash.left, top: slash.top }}
          onMouseDown={(event) => event.preventDefault()} onClick={(event) => event.stopPropagation()}>
          <div className="kb-be-slash-head">基础块与插入</div>
          {filteredSlash.length === 0 ? <div className="kb-be-slash-empty">没有匹配的块类型</div> : filteredSlash.map((item, index) => (
            <button key={item.id} className={`kb-be-slash-item${index === slashIndex ? ' active' : ''}`}
              onMouseEnter={() => setSlashIndex(index)} onClick={() => applySlashItem(item)}>
              <span className="kb-be-slash-icon">{item.icon}</span>
              <span className="kb-be-slash-name">{item.name}</span>
              <span className="kb-be-slash-hint">{item.hint.split(' ')[0]}</span>
            </button>
          ))}
          <div className="kb-be-slash-foot">↑↓ 选择 · ↵ 插入 · Esc 关闭</div>
        </div>
      )}

      {mention && (
        <div className="kb-be-mention-menu" style={{ left: mention.left, top: mention.top }}
          onMouseDown={(event) => event.preventDefault()} onClick={(event) => event.stopPropagation()}>
          <div className="kb-be-slash-head">@ 引用知识库文档</div>
          {filteredMention.length === 0
            ? <div className="kb-be-slash-empty">没有匹配的文档</div>
            : filteredMention.map((doc, index) => {
              const icon = doc.kind === 'file' ? attachmentIcon(doc.fileName ?? '', doc.fileType ?? '') : { label: '📄', cls: 'file' }
              return (
                <button key={doc.id} className={`kb-be-slash-item${index === mentionIndex ? ' active' : ''}`}
                  onMouseEnter={() => setMentionIndex(index)} onClick={() => applyMention(doc)}>
                  <span className={`kb-be-mention-icon ${icon.cls}`}>{icon.label}</span>
                  <span className="kb-be-slash-name">{doc.title || doc.fileName || '无标题'}</span>
                  <span className="kb-be-slash-hint">{doc.kind === 'file' ? '文件' : '页面'}</span>
                </button>
              )
            })}
          <div className="kb-be-slash-foot">↑↓ 选择 · ↵ 插入 · Esc 关闭</div>
        </div>
      )}

      {toolbar && (
        <div className="kb-be-toolbar" style={{ left: toolbar.left, top: toolbar.top }}
          onMouseDown={(event) => event.preventDefault()}>
          <button title="加粗" onClick={() => execFormat('bold')}><b>B</b></button>
          <button title="斜体" onClick={() => execFormat('italic')}><i>I</i></button>
          <button title="下划线" onClick={() => execFormat('underline')}><u>U</u></button>
          <button title="删除线" onClick={() => execFormat('strikeThrough')}><s>S</s></button>
          <button title="行内代码" onClick={insertInlineCode}>{'<>'}</button>
          <span className="kb-be-tool-sep" />
          <label className="kb-be-color" title="文字颜色">A<input type="color" defaultValue="#191919"
            onChange={(e) => execFormat('foreColor', e.target.value)} /></label>
          <label className="kb-be-color kb-be-mark" title="文字高亮">H<input type="color" defaultValue="#FFF3A3"
            onChange={(e) => execFormat('hiliteColor', e.target.value)} /></label>
        </div>
      )}
    </div>
    {viewingFile && (
      <FileViewer
        fileData={viewingFile.fileData}
        fileName={viewingFile.name}
        fileType={viewingFile.fileType}
        onClose={() => setViewingFile(null)}
      />
    )}
    {viewingImage && (
      <ImageLightbox src={viewingImage.src} alt={viewingImage.alt} onClose={() => setViewingImage(null)} />
    )}
    </>
  )
}

/** 图片大图查看层：支持缩放、下载与 Esc 关闭 */
