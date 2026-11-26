import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../../components/ui'

const PREFIX = 'xingce-sketch-v1-'
const INK = '#e54545'

/**
 * 覆盖在题目卡片上的透明手写层：笔迹直接写在原题上，按题目 ID 保存。
 * active 时接收指针事件并显示右侧工具条；退出后笔迹保留但不再拦截点击。
 */
export default function QuestionSketch({
  questionId,
  active,
  onExit,
}: {
  questionId: string
  active: boolean
  onExit: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const historyRef = useRef<string[]>([])
  const initialRef = useRef(false)
  const [eraser, setEraser] = useState(false)

  const key = `${PREFIX}${questionId}`

  const save = (data: string) => {
    try { window.sessionStorage.setItem(key, data) } catch { /* 忽略存储失败 */ }
  }

  const restore = (data: string) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
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
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (current) {
        restore(current)
      } else {
        initialRef.current = true
        let saved = ''
        try { saved = window.sessionStorage.getItem(key) ?? '' } catch { /* 忽略存储失败 */ }
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
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    ctx.strokeStyle = INK
    ctx.lineWidth = eraser ? 22 : 3
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
      <div className={`qs-layer${active ? ' active' : ''}`} ref={wrapRef} aria-hidden="true">
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
        <div className="qs-tools">
          <button onClick={undo} title="撤销" aria-label="撤销">
            <Icon name="undo" size={17} /><span>撤销</span>
          </button>
          <button className={eraser ? 'active' : ''} onClick={() => setEraser((value) => !value)} title="擦除" aria-label="擦除">
            <Icon name="eraser" size={17} /><span>擦除</span>
          </button>
          <button onClick={clear} title="清空" aria-label="清空">
            <Icon name="trash" size={17} /><span>清空</span>
          </button>
          <button onClick={onExit} title="退出草稿" aria-label="退出草稿">
            <Icon name="x" size={17} /><span>退出</span>
          </button>
        </div>
      )}
    </>
  )
}
