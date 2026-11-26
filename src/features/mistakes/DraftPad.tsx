import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../../components/ui'

const DRAFT_KEY = 'xingce-practice-draft-v1'
const COLORS = [
  { label: '黑', value: '#1f2937' },
  { label: '红', value: '#e54545' },
  { label: '蓝', value: '#1c7cff' },
]

/** 开始新一轮练习或退出时清空草稿 */
export function clearDraft() {
  try { window.sessionStorage.removeItem(DRAFT_KEY) } catch { /* 忽略存储失败 */ }
}

export default function DraftPad({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const drawingRef = useRef(false)
  const historyRef = useRef<string[]>([])
  const initialRef = useRef(false)
  const [color, setColor] = useState(COLORS[1].value)
  const [eraser, setEraser] = useState(false)
  const [hasInk, setHasInk] = useState(false)

  const save = (data: string) => {
    try { window.sessionStorage.setItem(DRAFT_KEY, data) } catch { /* 忽略存储失败 */ }
  }

  const restore = (data: string) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    if (!data) {
      setHasInk(false)
      return
    }
    const image = new Image()
    image.onload = () => {
      const target = canvasRef.current
      const context = target?.getContext('2d')
      if (!target || !context) return
      context.save()
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.drawImage(image, 0, 0, target.width, target.height)
      context.restore()
      setHasInk(true)
    }
    image.src = data
  }

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const ratio = window.devicePixelRatio || 1
      const current = initialRef.current && canvas.width ? canvas.toDataURL('image/png') : ''
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (current) {
        restore(current)
      } else {
        initialRef.current = true
        let saved = ''
        try { saved = window.sessionStorage.getItem(DRAFT_KEY) ?? '' } catch { /* 忽略存储失败 */ }
        restore(saved)
      }
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    historyRef.current.push(canvas.toDataURL('image/png'))
    if (historyRef.current.length > 20) historyRef.current.shift()
    drawingRef.current = true
    const point = pointOf(event)
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    ctx.strokeStyle = color
    ctx.lineWidth = eraser ? 18 : 3
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
    ctx.lineTo(point.x + 0.01, point.y + 0.01)
    ctx.stroke()
    setHasInk(true)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    event.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const point = pointOf(event)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
  }

  const onPointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    save(canvasRef.current?.toDataURL('image/png') ?? '')
  }

  const clear = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    historyRef.current.push(canvas.toDataURL('image/png'))
    restore('')
    save('')
  }

  const undo = () => {
    const previous = historyRef.current.pop()
    if (!previous) {
      clear()
      return
    }
    restore(previous)
    save(previous)
  }

  return (
    <>
      <div className="pe-draft-mask" onClick={onClose} />
      <aside className="pe-draft" aria-label="草稿纸">
        <div className="pe-draft-head">
          <span className="pe-draft-title">草稿纸</span>
          <button className="pe-icon" onClick={onClose} title="关闭草稿" aria-label="关闭草稿">
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="pe-draft-tools">
          {COLORS.map((item) => (
            <button
              key={item.value}
              className={`pe-draft-color${!eraser && color === item.value ? ' active' : ''}`}
              onClick={() => { setColor(item.value); setEraser(false) }}
              title={`${item}色画笔`}
              aria-label={`${item}色画笔`}
            >
              <i style={{ background: item.value }} />
              <span>{item.label}</span>
            </button>
          ))}
          <span className="pe-draft-sep" />
          <button className={`pe-draft-tool${eraser ? ' active' : ''}`} onClick={() => setEraser((value) => !value)} title="橡皮擦">橡皮</button>
          <button className="pe-draft-tool" onClick={undo} title="撤销">撤销</button>
          <button className="pe-draft-tool" onClick={clear} title="清空">清空</button>
        </div>
        <div className="pe-draft-canvas-wrap" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            className="pe-draft-canvas"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerUp}
          />
          {!hasInk && <div className="pe-draft-tip">在这里手写演算，支持鼠标与触屏</div>}
        </div>
        <div className="pe-draft-foot">草稿自动保存，刷新页面不会丢失</div>
      </aside>
    </>
  )
}
