/**
 * 轻量富文本编辑器（题库材料专用）。
 * - 文字排版：加粗 / 斜体 / 下划线 / 有序列表 / 无序列表 / 清除格式
 * - 插入图片：压缩后以内嵌 DataURL 插入，适合图形推理、资料分析图表
 * - 图片拖拽右下角手柄缩放，点击 × 删除
 * - 所有输出经 DOMPurify 白名单过滤，避免 XSS
 */
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { compressImage } from '../lib/image'
import { sanitizeRichHtml } from '../lib/richText'
import { Icon } from './ui'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

interface DragState { img: HTMLImageElement; startX: number; startWidth: number }

export default function RichTextEditor({ value, onChange, placeholder = '可输入文字、插入图片并拖拽调整大小…' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<Record<string, boolean>>({})

  const emit = () => {
    const root = rootRef.current
    if (!root) return
    onChange(sanitizeRichHtml(root.innerHTML))
  }

  // 外部值变化时同步 DOM；编辑中不覆盖，避免光标跳走
  useEffect(() => {
    const root = rootRef.current
    if (!root || root.contains(document.activeElement)) return
    if (root.innerHTML !== value) root.innerHTML = value
  }, [value])

  const refreshActive = () => {
    if (typeof document.queryCommandState !== 'function') return
    setActive({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
      insertUnorderedList: document.queryCommandState('insertUnorderedList'),
      insertOrderedList: document.queryCommandState('insertOrderedList'),
    })
  }

  const exec = (command: string, arg?: string) => {
    rootRef.current?.focus()
    document.execCommand(command, false, arg)
    emit()
    refreshActive()
  }

  // 图片缩放 / 删除：Pointer Events 同时覆盖鼠标与触摸
  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (target.classList.contains('rt-handle')) {
        const img = target.parentElement?.querySelector('img')
        if (!img) return
        e.preventDefault()
        target.setPointerCapture(e.pointerId)
        dragRef.current = { img, startX: e.clientX, startWidth: img.getBoundingClientRect().width }
      } else if (target.classList.contains('rt-remove')) {
        e.preventDefault()
        target.parentElement?.remove()
        emit()
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      e.preventDefault()
      const width = Math.round(Math.max(48, Math.min(1200, drag.startWidth + e.clientX - drag.startX)))
      drag.img.style.width = `${width}px`
      drag.img.setAttribute('width', String(width))
      drag.img.setAttribute('data-w', String(width))
    }
    const onPointerUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      emit()
      refreshActive()
    }

    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('pointermove', onPointerMove)
    root.addEventListener('pointerup', onPointerUp)
    root.addEventListener('pointercancel', onPointerUp)
    return () => {
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('pointermove', onPointerMove)
      root.removeEventListener('pointerup', onPointerUp)
      root.removeEventListener('pointercancel', onPointerUp)
    }
  }, [onChange])

  const handleImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (!files.length) return
    setBusy(true)
    try {
      const sources = await Promise.all(files.map((f) => compressImage(f)))
      const root = rootRef.current
      if (!root) return
      root.focus()
      // 折叠选区到末尾，避免「先全选文字再插入图片」时误替换已有内容
      const selection = window.getSelection()
      if (selection) {
        const range = document.createRange()
        range.selectNodeContents(root)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      }
      for (const src of sources) {
        const markup = `<span class="rt-image" contenteditable="false"><img src="${src}" alt="材料图片" width="360" style="width:360px"><span class="rt-handle" title="拖拽调整大小"></span><span class="rt-remove" title="删除图片">×</span></span>`
        document.execCommand('insertHTML', false, markup)
      }
      emit()
      refreshActive()
    } catch {
      // 图片处理失败时静默忽略，不阻断表单编辑
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  const tool = (label: ReactNode, title: string, command: string, arg?: string, key?: string) => (
    <button
      type="button"
      className={`rte-tool ${key && active[key] ? 'active' : ''}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => exec(command, arg)}
    >{label}</button>
  )

  return (
    <div className="rte">
      <div className="rte-toolbar">
        {tool(<b>B</b>, '加粗', 'bold', undefined, 'bold')}
        {tool(<i>I</i>, '斜体', 'italic', undefined, 'italic')}
        {tool(<u>U</u>, '下划线', 'underline', undefined, 'underline')}
        <span className="rte-sep" />
        {tool(<Icon name="list" size={14} />, '无序列表', 'insertUnorderedList', undefined, 'insertUnorderedList')}
        {tool(<span style={{ fontWeight: 700 }}>1.</span>, '有序列表', 'insertOrderedList', undefined, 'insertOrderedList')}
        <span className="rte-sep" />
        <button
          type="button"
          className="rte-tool"
          title="插入图片（可拖拽调整大小）"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Icon name="image" size={14} /> {busy ? '处理中…' : '插入图片'}
        </button>
        {tool('清除格式', '清除格式', 'removeFormat')}
        <span className="rte-hint">图片可拖拽右下角调整大小</span>
      </div>
      <div
        ref={rootRef}
        className="rte-body"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        onKeyUp={refreshActive}
        onMouseUp={refreshActive}
        onFocus={refreshActive}
        onBlur={emit}
      />
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void handleImages(e)} />
    </div>
  )
}
