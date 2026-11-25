import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Block, BlockType, Doc, SlashState, ToolbarState } from '../types'
import { escapeHtml } from '../lib/markdown'
import { makeBlock } from '../lib/storage'

type SlashItem = {
  id: string
  name: string
  icon: string
  hint: string
  type: BlockType
}

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
  { id: 'link', name: '超链接', icon: '↗', hint: 'link 链接', type: 'link' },
  { id: 'docref', name: '引用文档', icon: '▤', hint: 'doc 文档 引用', type: 'docref' },
]

const CODE_LANGUAGES = ['javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'java', 'go', 'sql']

function getBlockEl(container: HTMLElement | null, id: string): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-block-id="${id}"] .block-content`) ?? null
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
  const prism = (window as { Prism?: { languages?: Record<string, unknown>; highlight: (text: string, grammar: unknown, lang: string) => string } }).Prism
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
  block: Block
  total: number
  docs: Doc[]
  slashActive: boolean
  dragOver: boolean
  onUpdate: (patch: Partial<Block>) => void
  onDelete: () => void
  onInsertAfter: (type?: BlockType) => void
  onEnter: () => void
  onSlash: (state: SlashState | null) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (id: string) => void
  onDrop: (fromId: string, toId: string) => void
  onNavigateDoc: (id: string) => void
  updateCell: (row: number, col: number, value: string) => void
  addRow: () => void
  addCol: () => void
}

function BlockItem({
  block, total, docs, slashActive, dragOver, onUpdate, onDelete, onInsertAfter, onEnter,
  onSlash, onDragStart, onDragEnd, onDragOver, onDrop, onNavigateDoc, updateCell, addRow, addCol,
}: BlockItemProps) {
  const ref = useRef<HTMLDivElement>(null)
  const lastHtml = useRef(block.html)
  const mounted = useRef(false)
  const isRich = !['code', 'table', 'divider', 'image', 'link', 'docref'].includes(block.type)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 首次挂载或外部数据变化时写入 DOM；用户输入时不写回，避免光标丢失
    if (!mounted.current || block.html !== lastHtml.current) {
      el.innerHTML = block.html
      lastHtml.current = block.html
      mounted.current = true
    }
  }, [block.html])

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
    for (const [pattern, type] of rules) {
      const match = pattern.exec(text)
      if (!match) continue
      const rest = match[1] ?? ''
      el.innerHTML = escapeHtml(rest)
      lastHtml.current = el.innerHTML
      const patch: Partial<Block> = { type, html: el.innerHTML, text: rest }
      if (type === 'todo') patch.checked = false
      if (type === 'code') patch.language = 'javascript'
      onUpdate(patch)
      setCaret(el, 0)
      onSlash(null)
      return
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
    } else {
      onSlash(null)
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (slashActive) return
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
        <div className="code-block">
          <div className="code-head">
            <select className="code-lang" value={language} onChange={(e) => onUpdate({ language: e.target.value })}>
              {CODE_LANGUAGES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
            <span className="code-hint">语法高亮由 Prism 提供</span>
          </div>
          <textarea className="code-input" value={block.text} spellCheck={false}
            onChange={(e) => onUpdate({ text: e.target.value, html: '' })}
            placeholder="输入代码…" />
          <pre className="code-preview"><code className={`language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlightCode(block.text, language) }} /></pre>
        </div>
      )
    }
    if (block.type === 'table') {
      return (
        <div className="table-block">
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
          <div className="table-ops"><button onClick={addRow}>+ 行</button><button onClick={addCol}>+ 列</button></div>
        </div>
      )
    }
    if (block.type === 'divider') return <hr className="block-divider" />
    if (block.type === 'image') {
      return block.src ? (
        <figure className="media-block">
          <img src={block.src} alt={block.text || '图片'} />
          <figcaption contentEditable suppressContentEditableWarning
            onBlur={(e) => onUpdate({ text: e.currentTarget.innerText })}>{block.text}</figcaption>
        </figure>
      ) : (
        <div className="media-empty">
          <input className="input" placeholder="粘贴图片 URL" onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) onUpdate({ src: e.currentTarget.value.trim() })
          }} />
          <label className="btn btn-sm">或选择本地图片
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
    if (block.type === 'link') {
      return block.href ? (
        <p className="link-block"><a href={block.href} target="_blank" rel="noreferrer">{block.text || block.href}</a></p>
      ) : (
        <div className="media-empty">
          <input className="input" placeholder="链接文字" data-field="label" />
          <input className="input" placeholder="https://example.com" data-field="href"
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
      <div className="docref-block">
        <select className="input" value={block.docId ?? ''} onChange={(e) => onUpdate({ docId: e.target.value })}>
          <option value="">选择文档…</option>
          {docs.map((doc) => <option key={doc.id} value={doc.id}>{doc.title || '无标题'}</option>)}
        </select>
        {targetDoc && <button className="btn btn-sm" onClick={() => onNavigateDoc(targetDoc.id)}>打开「{targetDoc.title || '无标题'}」</button>}
      </div>
    )
  }

  return (
    <div className={`editor-block block-${block.type}${dragOver ? ' drag-over' : ''}`}
      data-block-id={block.id}
      onDragOver={(e) => { e.preventDefault(); onDragOver(block.id) }}
      onDrop={(e) => { e.preventDefault(); onDrop(e.dataTransfer.getData('text/plain'), block.id) }}>
      <div className="block-gutter">
        <button className="block-handle" draggable title="拖拽排序"
          onDragStart={(e) => { e.dataTransfer.setData('text/plain', block.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(block.id) }}
          onDragEnd={onDragEnd}>⠿</button>
        <button className="block-add" title="在下方插入文本块" onClick={() => onInsertAfter()}>+</button>
      </div>
      <div className="block-main">
        {block.type === 'todo' && (
          <input type="checkbox" className="todo-check" checked={Boolean(block.checked)}
            onChange={(e) => onUpdate({ checked: e.target.checked })} />
        )}
        {block.type === 'bullet' && <span className="list-marker">•</span>}
        {block.type === 'number' && <span className="list-marker">1.</span>}
        {block.type === 'quote' && <span className="quote-marker" />}
        {isRich ? (
          <div ref={ref} className={`block-content block-content-${block.type}`} contentEditable
            suppressContentEditableWarning spellCheck={false} data-placeholder={placeholderOf(block.type)}
            onInput={handleInput} onKeyDown={handleKeyDown} />
        ) : renderSpecial()}
      </div>
      <button className="block-delete" title="删除块" onClick={onDelete}>×</button>
    </div>
  )
}

interface EditorProps {
  doc: Doc
  docs: Doc[]
  onChangeBlocks: (blocks: Block[]) => void
  onNavigateDoc: (id: string) => void
}

export default function Editor({ doc, docs, onChangeBlocks, onNavigateDoc }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [slash, setSlash] = useState<SlashState | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const [toolbar, setToolbar] = useState<ToolbarState | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [, setPrismReady] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => {
      if ((window as { Prism?: unknown }).Prism) { setPrismReady(true); window.clearInterval(timer) }
    }, 600)
    return () => window.clearInterval(timer)
  }, [])

  const filteredSlash = useMemo(() => {
    if (!slash) return []
    const query = slash.query.trim().toLowerCase()
    if (!query) return SLASH_ITEMS
    return SLASH_ITEMS.filter((item) => item.name.toLowerCase().includes(query) || item.hint.toLowerCase().includes(query))
  }, [slash?.query])

  useEffect(() => { setSlashIndex(0) }, [slash?.query])

  // 斜杠菜单的键盘操作放在捕获阶段，优先于块内 Enter 处理
  useEffect(() => {
    if (!slash) return
    const handler = (event: KeyboardEvent) => {
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

  const updateBlock = (id: string, patch: Partial<Block>) => {
    onChangeBlocks(doc.blocks.map((block) => block.id === id ? { ...block, ...patch } : block))
  }

  const focusBlock = (id: string) => {
    requestAnimationFrame(() => {
      const el = getBlockEl(containerRef.current, id)
      if (el?.isContentEditable) { el.focus(); setCaret(el, el.childNodes.length) }
    })
  }

  const insertAfter = (id: string, type: BlockType = 'text') => {
    const index = doc.blocks.findIndex((block) => block.id === id)
    if (index < 0) return
    const block = makeBlock(type)
    const next = [...doc.blocks]
    next.splice(index + 1, 0, block)
    onChangeBlocks(next)
    focusBlock(block.id)
  }

  const deleteBlock = (id: string) => {
    const index = doc.blocks.findIndex((block) => block.id === id)
    if (index < 0) return
    if (doc.blocks.length === 1) { updateBlock(id, { type: 'text', html: '', text: '' }); focusBlock(id); return }
    const next = doc.blocks.filter((block) => block.id !== id)
    onChangeBlocks(next)
    focusBlock(next[Math.max(0, index - 1)].id)
  }

  const moveBlock = (fromId: string, toId: string) => {
    if (!fromId || fromId === toId) return
    const next = [...doc.blocks]
    const from = next.findIndex((block) => block.id === fromId)
    const to = next.findIndex((block) => block.id === toId)
    if (from < 0 || to < 0) return
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChangeBlocks(next)
    setDragId(null)
    setDragOverId(null)
  }

  const applySlashItem = (item: SlashItem) => {
    if (!slash) return
    const patch: Partial<Block> = { type: item.type, html: '', text: '' }
    if (item.type === 'todo') patch.checked = false
    if (item.type === 'code') patch.language = 'javascript'
    if (item.type === 'table') patch.rows = [['', ''], ['', '']]
    if (item.type === 'image') patch.src = ''
    if (item.type === 'link') patch.href = ''
    if (item.type === 'docref') patch.docId = docs[0]?.id
    updateBlock(slash.blockId, patch)
    setSlash(null)
    focusBlock(slash.blockId)
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
    <div className="editor" ref={containerRef} onClick={() => { if (slash) setSlash(null) }}>
      {doc.blocks.map((block) => (
        <BlockItem key={block.id} block={block} total={doc.blocks.length} docs={docs}
          slashActive={slash?.blockId === block.id}
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
          onNavigateDoc={onNavigateDoc}
          updateCell={(row, col, value) => {
            const rows = (block.rows ?? []).map((cells, r) => cells.map((cell, c) => r === row && c === col ? value : cell))
            updateBlock(block.id, { rows })
          }}
          addRow={() => updateBlock(block.id, { rows: [...(block.rows ?? []), ['', '']] })}
          addCol={() => updateBlock(block.id, { rows: (block.rows ?? []).map((row) => [...row, '']) })}
        />
      ))}

      {slash && (
        <div className="slash-menu" style={{ left: slash.left, top: slash.top }}
          onMouseDown={(event) => event.preventDefault()} onClick={(event) => event.stopPropagation()}>
          <div className="slash-head">基础块与插入</div>
          {filteredSlash.length === 0 ? <div className="slash-empty">没有匹配的块类型</div> : filteredSlash.map((item, index) => (
            <button key={item.id} className={`slash-item${index === slashIndex ? ' active' : ''}`}
              onMouseEnter={() => setSlashIndex(index)} onClick={() => applySlashItem(item)}>
              <span className="slash-icon">{item.icon}</span>
              <span className="slash-name">{item.name}</span>
              <span className="slash-hint">{item.hint.split(' ')[0]}</span>
            </button>
          ))}
          <div className="slash-foot">↑↓ 选择 · ↵ 插入 · Esc 关闭</div>
        </div>
      )}

      {toolbar && (
        <div className="float-toolbar" style={{ left: toolbar.left, top: toolbar.top }}
          onMouseDown={(event) => event.preventDefault()}>
          <button title="加粗" onClick={() => execFormat('bold')}><b>B</b></button>
          <button title="斜体" onClick={() => execFormat('italic')}><i>I</i></button>
          <button title="下划线" onClick={() => execFormat('underline')}><u>U</u></button>
          <button title="删除线" onClick={() => execFormat('strikeThrough')}><s>S</s></button>
          <button title="行内代码" onClick={insertInlineCode}>{'<>'}</button>
          <span className="tool-sep" />
          <label className="color-btn" title="文字颜色">A<input type="color" defaultValue="#191919"
            onChange={(e) => execFormat('foreColor', e.target.value)} /></label>
          <label className="color-btn mark-btn" title="文字高亮">H<input type="color" defaultValue="#FFF3A3"
            onChange={(e) => execFormat('hiliteColor', e.target.value)} /></label>
        </div>
      )}
    </div>
  )
}
