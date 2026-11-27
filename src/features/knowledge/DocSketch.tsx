import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../../components/ui'

const PREFIX = 'xingce-docsketch-v1-'
const COLORS = [
  { label: '红', value: '#e54545' },
  { label: '黑', value: '#1f2937' },
  { label: '蓝', value: '#1c7cff' },
]
type Tool = 'pen' | 'eraser'

/**
 * 文档手写层：覆盖在 PDF/Word 阅读纸张上的透明画布。
 * - 按文档 ID 持久化笔迹到 localStorage，刷新后保留；
 * - active 时接收指针事件并显示工具栏，退出后笔迹仍可见但不拦截文档点击；
 * - 文档尺寸/缩放变化时按当前画布比例保留笔迹。
 */
export default function DocSketch({
  sketchKey,
  active,
  onExit,
}: {
  sketchKey: string
  active: boolean
  onExit: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const historyRef = useRef<string[]>([])
  const initialRef = useRef(false)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0].value)

  const key = `${PREFIX}${sketchKey}`

  const save = (data: string) => {
    try { window.localStorage.setItem(key, data) } catch { /* 忽略存储失败 */ }
  }

  const restore = (data: string) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    if (!data) return
    const image = new Image()
    image.onload = () => {
      const target = canvasRef.current
      const context = target?.getContext('2d')
      if (!target || !context) return
      context.save()
      context.globalCompositeOperation = 'source-over'
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.drawImage(image, 0, 0, target.width, target.height)
      context.restore()
    }
    image.src = data
  }

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const ratio = window.devicePixelRatio || 1
      const current = initialRef.current && canvas.width ? canvas.toDataURL('image/png') : ''
      canvas.width = Math.round(rect.width * ratio)
      canvas.height = Math.round(rect.height * ratio)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.globalCompositeOperation = 'source-over'
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (current) {
        restore(current)
      } else {
        initialRef.current = true
        let saved = ''
        try { saved = window.localStorage.getItem(key) ?? '' } catch { /* 忽略读取失败 */ }
        restore(saved)
      }
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [key])

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    historyRef.current.push(canvas.toDataURL('image/png'))
    if (historyRef.current.length > 20) historyRef.current.shift()
    drawingRef.current = true
    const point = pointOf(event)
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = tool === 'eraser' ? '#000000' : color
    ctx.lineWidth = tool === 'eraser' ? 24 : 3
    ctx.beginPath()
    ctx.moveTo(point.x, point.y)
    ctx.lineTo(point.x + 0.01, point.y + 0.01)
    ctx.stroke()
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active || !drawingRef.current) return
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
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) ctx.globalCompositeOperation = 'source-over'
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
    if (!previous) { clear(); return }
    restore(previous)
    save(previous)
  }

  const pickColor = (value: string) => { setColor(value); setTool('pen') }

  return (
    <>
      <div
        className={`ds-layer${active ? ' active' : ''}`}
        ref={wrapRef}
        data-doc-sketch={sketchKey}
        aria-hidden="true"
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerUp}
        />
      </div>
      {active && (
        <div className="ds-tools">
          <button onClick={undo} title="撤销" aria-label="撤销"><Icon name="undo" size={17} /><span>撤销</span></button>
          <button className={tool === 'pen' ? 'active' : ''} onClick={() => setTool('pen')} title="手写" aria-label="手写"><Icon name="edit" size={17} /><span>手写</span></button>
          <button className={tool === 'eraser' ? 'active' : ''} onClick={() => setTool('eraser')} title="擦除" aria-label="擦除"><Icon name="eraser" size={17} /><span>擦除</span></button>
          <div className="qs-color-row" role="group" aria-label="画笔颜色">
            {COLORS.map((item) => (
              <button
                key={item.value}
                className={`qs-swatch${tool === 'pen' && color === item.value ? ' active' : ''}`}
                style={{ background: item.value }}
                onClick={() => pickColor(item.value)}
                title={`${item.label}色画笔`}
                aria-label={`${item.label}色画笔`}
              />
            ))}
          </div>
          <button onClick={clear} title="清空" aria-label="清空"><Icon name="trash" size={17} /><span>清空</span></button>
          <button onClick={onExit} title="退出手写" aria-label="退出手写"><Icon name="x" size={17} /><span>退出</span></button>
        </div>
      )}
    </>
  )
}
