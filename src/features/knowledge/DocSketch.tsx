import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../../components/ui'

const PREFIX = 'xingce-docsketch-v2-'
const LEGACY_PREFIX = 'xingce-docsketch-v1-'
const COLORS = [
  { label: '红', value: '#e54545' },
  { label: '黑', value: '#1f2937' },
  { label: '蓝', value: '#1c7cff' },
]
type Tool = 'pen' | 'eraser'
type Point = [number, number] // 归一化坐标 0-1，保证缩放/尺寸变化时笔迹跟随

interface Stroke {
  c: string      // color
  t: Tool        // tool
  w: number      // width（CSS px）
  p: Point[]     // points
  img?: string   // 旧版 PNG 底图（兼容迁移）
}
interface SketchData { v: 2; strokes: Stroke[] }

const imageCache = new Map<string, HTMLImageElement>()
function getImage(src: string, onChange: () => void): HTMLImageElement | null {
  let img = imageCache.get(src)
  if (!img) {
    img = new Image()
    img.onload = onChange
    img.src = src
    imageCache.set(src, img)
  }
  return img.complete && img.naturalWidth ? img : null
}

function loadData(key: string, legacy: string): SketchData {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as SketchData
      if (Array.isArray(parsed.strokes)) return parsed
    }
    // 兼容旧版整图 PNG：作为底图 stroke，仅加载一次
    const old = window.localStorage.getItem(legacy)
    if (old && old.startsWith('data:image')) {
      return { v: 2, strokes: [{ c: '', t: 'pen', w: 0, p: [], img: old }] }
    }
  } catch { /* 忽略读取失败 */ }
  return { v: 2, strokes: [] }
}

/**
 * 文档手写层：笔迹以「笔画点数组」存储（JSON，通常几 KB），不再对整张画布
 * toDataURL（大文档可达数 MB，是之前书写卡顿的根因）。resize 时按归一化坐标
 * 重绘，不做昂贵的图片编解码；pointermove 用 requestAnimationFrame 增量绘制。
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
  const strokesRef = useRef<Stroke[]>([])
  const currentRef = useRef<Stroke | null>(null)
  const drawingRef = useRef(false)
  const drawnIndexRef = useRef(0)
  const sizeRef = useRef({ w: 0, h: 0 })
  const rafRef = useRef(0)
  const resizeRafRef = useRef(0)
  const [tool, setTool] = useState<Tool>('pen')
  const toolRef = useRef<Tool>(tool)
  const [color, setColor] = useState(COLORS[0].value)
  const colorRef = useRef(color)

  const key = `${PREFIX}${sketchKey}`
  const legacyKey = `${LEGACY_PREFIX}${sketchKey}`

  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { colorRef.current = color }, [color])

  const save = () => {
    try {
      window.localStorage.setItem(key, JSON.stringify({ v: 2, strokes: strokesRef.current }))
    } catch { /* 忽略存储失败 */ }
  }

  /** 全量重绘：尺寸变化、撤销、清空、笔迹加载时调用 */
  const redraw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const { w, h } = sizeRef.current
    if (!w || !h) return
    const ratio = window.devicePixelRatio || 1
    const declaredW = Math.round(w * ratio)
    const declaredH = Math.round(h * ratio)
    if (canvas.width !== declaredW || canvas.height !== declaredH) {
      canvas.width = declaredW
      canvas.height = declaredH
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokesRef.current) paintStroke(ctx, stroke, w, h, 1)
    drawnIndexRef.current = currentRef.current?.p.length ?? 0
  }

  /** 绘制一段笔画；from=1 表示整笔，>1 表示只画新增点（增量绘制） */
  function paintStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, w: number, h: number, from: number) {
    if (stroke.img) {
      const image = getImage(stroke.img, () => scheduleRedraw())
      if (image) {
        ctx.save()
        ctx.globalCompositeOperation = 'source-over'
        ctx.drawImage(image, 0, 0, w, h)
        ctx.restore()
      }
      return
    }
    const points = stroke.p
    if (!points.length) return
    ctx.save()
    ctx.globalCompositeOperation = stroke.t === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = stroke.c
    ctx.fillStyle = stroke.c
    ctx.lineWidth = stroke.w
    const start = Math.max(0, from - 1)
    ctx.beginPath()
    ctx.moveTo(points[start][0] * w, points[start][1] * h)
    for (let i = start + 1; i < points.length; i += 1) ctx.lineTo(points[i][0] * w, points[i][1] * h)
    if (points.length === 1) {
      ctx.arc(points[0][0] * w, points[0][1] * h, stroke.w / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.stroke()
    }
    ctx.restore()
  }

  const scheduleRedraw = () => {
    if (resizeRafRef.current) return
    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = 0
      redraw()
    })
  }

  // 初始化笔迹 + 尺寸监听（rAF 合并，尺寸未变则跳过，避免 docx 渲染时反复重建画布）
  useEffect(() => {
    strokesRef.current = loadData(key, legacyKey).strokes
    const wrap = wrapRef.current
    if (!wrap) return
    const resize = () => {
      const rect = wrap.getBoundingClientRect()
      const { w, h } = sizeRef.current
      if (!rect.width || !rect.height) return
      if (Math.abs(rect.width - w) < 1 && Math.abs(rect.height - h) < 1) return
      sizeRef.current = { w: rect.width, h: rect.height }
      scheduleRedraw()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(wrap)
    return () => {
      observer.disconnect()
      if (resizeRafRef.current) window.cancelAnimationFrame(resizeRafRef.current)
    }
  }, [key, legacyKey])

  // 卸载时取消未执行的绘制帧
  useEffect(() => () => { if (rafRef.current) window.cancelAnimationFrame(rafRef.current) }, [])

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [(event.clientX - rect.left) / (rect.width || 1), (event.clientY - rect.top) / (rect.height || 1)]
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const stroke: Stroke = {
      c: toolRef.current === 'eraser' ? '#000000' : colorRef.current,
      t: toolRef.current,
      w: toolRef.current === 'eraser' ? 24 : 3,
      p: [pointOf(event)],
    }
    strokesRef.current.push(stroke)
    currentRef.current = stroke
    drawnIndexRef.current = 1
    drawingRef.current = true
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) paintStroke(ctx, stroke, sizeRef.current.w, sizeRef.current.h, 1)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active || !drawingRef.current || !currentRef.current) return
    event.preventDefault()
    currentRef.current.p.push(pointOf(event))
    if (rafRef.current) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0
      const stroke = currentRef.current
      const ctx = canvasRef.current?.getContext('2d')
      if (!stroke || !ctx || !drawingRef.current) return
      paintStroke(ctx, stroke, sizeRef.current.w, sizeRef.current.h, drawnIndexRef.current)
      drawnIndexRef.current = stroke.p.length
    })
  }

  const onPointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    currentRef.current = null
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      redraw()
    }
    save()
  }

  const clear = () => {
    strokesRef.current = []
    currentRef.current = null
    save()
    redraw()
  }

  const undo = () => {
    strokesRef.current.pop()
    currentRef.current = null
    save()
    redraw()
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
        <div className="ds-tools" onPointerDown={(event) => event.stopPropagation()}>
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
