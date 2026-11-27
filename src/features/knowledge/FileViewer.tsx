/** 应用内文件阅读器：统一用于知识库文件文档、全屏阅读与附件预览。
 *  采用「文档页」式版面（纸张、页边距、缩放、工具栏），支持 PDF / 图片 /
 *  DOCX / XLSX / PPTX / Markdown / TXT / CSV / JSON 等常见格式。 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { Icon } from '../../components/ui'
import { renderMarkdown } from '../../lib/markdown'
import { formatBytes } from '../../lib/docFile'
import { parsePptxDeck, type PptxDeck, type PptxPara, type PptxRun, type PptxShape } from '../../lib/pptxSlide'
import DocSketch from './DocSketch'

type PreviewKind = 'pdf' | 'image' | 'text' | 'markdown' | 'csv' | 'docx' | 'xlsx' | 'pptx' | 'unknown'

interface SlideData { text: string[]; images: string[] }

/** 需要按原始版式渲染的 Office 文件：由专用渲染器直接操作 DOM */
type NativeRender = {
  kind: 'docx' | 'pptx'
  buffer: ArrayBuffer
  fallback?: ReactNode
} | null

function detectKind(name: string, type: string): PreviewKind {
  const lower = name.toLowerCase()
  const ext = (lower.split('.').pop() ?? '').trim()
  if (ext === 'pdf' || type === 'application/pdf') return 'pdf'
  if (/^(png|jpe?g|gif|webp|bmp|svg|avif)$/.test(ext) || type.startsWith('image/')) return 'image'
  if (ext === 'md' || ext === 'markdown' || type === 'text/markdown') return 'markdown'
  if (ext === 'csv' || type === 'text/csv') return 'csv'
  if (ext === 'docx') return 'docx'
  if (/^(xlsx|xls)$/.test(ext)) return 'xlsx'
  if (ext === 'pptx') return 'pptx'
  if (/^(txt|text|log|json|ya?ml|ini|xml|html?|css|js|ts)$/.test(ext) || type.startsWith('text/')) return 'text'
  return 'unknown'
}

const KIND_LABEL: Record<PreviewKind, string> = {
  pdf: 'PDF', image: '图片', markdown: 'Markdown', csv: '表格',
  docx: 'Word', xlsx: 'Excel', pptx: '幻灯片', text: '文本', unknown: '文件',
}

/** DataURL → ArrayBuffer（兼容 base64 与 URI 编码两种形式） */
function decodeDataUrl(dataUrl: string): ArrayBuffer | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const meta = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (/;base64/i.test(meta)) {
    try {
      const binary = atob(payload.replace(/\s/g, ''))
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return bytes.buffer
    } catch { return null }
  }
  try { return new TextEncoder().encode(decodeURIComponent(payload)).buffer } catch { return null }
}

function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1 }
      else quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      row.push(cell); cell = ''
      if (row.some((v) => v.trim())) rows.push(row)
      row = []
    } else cell += char
  }
  row.push(cell)
  if (row.some((v) => v.trim())) rows.push(row)
  return rows
}

async function parsePptx(buffer: ArrayBuffer): Promise<SlideData[]> {
  const zip = await JSZip.loadAsync(buffer)
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(/slide(\d+)\.xml/.exec(a)?.[1] ?? 0)
      const nb = Number(/slide(\d+)\.xml/.exec(b)?.[1] ?? 0)
      return na - nb
    })
  const slides: SlideData[] = []
  for (const name of names) {
    const xml = await zip.file(name)!.async('string')
    const text = Array.from(xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g))
      .map((match) => decodeEntities(match[1]).trim()).filter(Boolean)
    const images: string[] = []
    const relName = `ppt/slides/_rels/${name.split('/').pop()}.rels`
    const relFile = zip.file(relName)
    if (relFile) {
      const relXml = await relFile.async('string')
      const rels = new Map<string, string>()
      for (const match of relXml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bTarget="([^"]+)"[^>]*\/>/g)) {
        rels.set(match[1], match[2])
      }
      const blipIds = Array.from(xml.matchAll(/<a:blip[^>]*\br:embed="([^"]+)"/g)).map((match) => match[1])
      for (const id of blipIds) {
        const target = rels.get(id)
        if (!target) continue
        const mediaPath = `ppt/${target.replace(/^\.\.\//, '').replace(/^\//, '')}`
        const media = zip.file(mediaPath)
        if (!media) continue
        const base64 = await media.async('base64')
        const ext = (mediaPath.split('.').pop() ?? 'png').toLowerCase()
        const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext
        images.push(`data:image/${mime};base64,${base64}`)
      }
    }
    slides.push({ text, images })
  }
  return slides
}

function useParsedFile(fileData: string, kind: PreviewKind) {
  const [content, setContent] = useState<ReactNode>(null)
  const [native, setNative] = useState<NativeRender>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      setLoading(true); setError(null); setContent(null); setNative(null)
      try {
        if (kind === 'pdf' || kind === 'image') {
          if (!cancelled) setLoading(false)
          return
        }
        const buffer = decodeDataUrl(fileData)
        if (!buffer) throw new Error('文件数据无效')
        if (kind === 'docx') {
          // 优先使用保留版式的渲染器；不可用时回退到文本抽取
          try {
            await import('docx-preview')
            if (!cancelled) setNative({ kind: 'docx', buffer })
          } catch {
            const { default: mammoth } = await import('mammoth')
            const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
            if (!cancelled) setContent(<div className="fr-rich" dangerouslySetInnerHTML={{ __html: sanitizeMammothHtml(result.value) }} />)
          }
        } else if (kind === 'xlsx') {
          const workbook = XLSX.read(buffer, { type: 'array' })
          const sheets = workbook.SheetNames.map((name) => ({
            name,
            table: XLSX.utils.sheet_to_html(workbook.Sheets[name]),
          }))
          if (!cancelled) setContent(
            <div className="fr-sheets">
              <div className="fr-page-heading">工作表 · 共 {sheets.length} 个</div>
              {sheets.map((sheet) => (
                <section className="fr-sheet" key={sheet.name}>
                  <h3>{sheet.name}</h3>
                  <div className="fr-table" dangerouslySetInnerHTML={{ __html: sanitizeSheetHtml(sheet.table) }} />
                </section>
              ))}
            </div>,
          )
        } else if (kind === 'pptx') {
          // 原版式幻灯片渲染；解析失败时回退到文字/图片版
          const slides = await parsePptx(buffer)
          const fallback = (
            <div className="fr-slides">
              <div className="fr-page-heading">幻灯片 · 共 {slides.length} 页</div>
              {slides.map((slide, index) => (
                <section className="fr-slide" key={index}>
                  <div className="fr-slide-no">第 {index + 1} 页</div>
                  {slide.images.map((src, i) => <img className="fr-slide-img" key={i} src={src} alt={`第 ${index + 1} 页图片 ${i + 1}`} />)}
                  {slide.text.map((line, i) => <p key={i}>{line}</p>)}
                  {!slide.text.length && !slide.images.length && <p className="fr-muted">（此页无可提取文字或图片）</p>}
                </section>
              ))}
            </div>
          )
          if (!cancelled) setNative({ kind: 'pptx', buffer, fallback })
        } else if (kind === 'csv') {
          const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
          const rows = parseCsv(text)
          if (!cancelled) setContent(
            <div className="fr-table fr-csv">
              <table><tbody>
                {rows.map((row, r) => <tr key={r}>{row.map((cell, c) => (
                  r === 0 ? <th key={c}>{cell}</th> : <td key={c}>{cell}</td>
                ))}</tr>)}
              </tbody></table>
            </div>,
          )
        } else if (kind === 'markdown' || kind === 'text') {
          const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer)
          if (kind === 'markdown') {
            if (!cancelled) setContent(<div className="fr-rich" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />)
          } else {
            if (!cancelled) setContent(<pre className="fr-pre">{text}</pre>)
          }
        } else {
          if (!cancelled) setContent(
            <div className="fr-unsupported">
              <div className="empty-icon"><Icon name="file" size={26} /></div>
              <h3>此格式暂不支持在线阅读</h3>
              <p>可点击右上角下载后用本地软件打开</p>
            </div>,
          )
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '文件解析失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void render()
    return () => { cancelled = true }
  }, [kind, fileData])

  return { content, native, loading, error }
}

/** Office 原版式渲染器：按文件原始排版输出 DOM，接近 PDF 阅读效果 */
function OfficeRenderer({ request }: { request: NonNullable<NativeRender> }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    host.innerHTML = ''
    setFailed(false)

    void (async () => {
      try {
        if (request.kind === 'docx') {
          const { renderAsync } = await import('docx-preview')
          if (cancelled) return
          await renderAsync(request.buffer, host, host, {
            className: 'fr-docx',
            inWrapper: true,
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            useBase64URL: true,
          })
        } else {
          // PPTX 用自研解析渲染（pptxSlide.ts），无需第三方 DOM 操作
        }
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      host.innerHTML = ''
    }
  }, [request])

  if (request.kind === 'pptx') return <PptxDocument buffer={request.buffer} fallback={request.fallback} />
  if (failed) {
    return (
      <div className="fr-unsupported">
        <div className="empty-icon"><Icon name="file" size={26} /></div>
        <h3>原版式渲染失败</h3>
        <p>可点击右上角下载后用本地软件打开</p>
      </div>
    )
  }
  return <div ref={hostRef} className={`fr-office fr-office-${request.kind}`} />
}

/** PPTX 原版式渲染：按幻灯片原始坐标绝对定位每个形状 */
function PptxDocument({ buffer, fallback }: { buffer: ArrayBuffer; fallback?: ReactNode }) {
  const [deck, setDeck] = useState<PptxDeck | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setDeck(null)
    setFailed(false)
    parsePptxDeck(buffer)
      .then((d) => { if (!cancelled) setDeck(d) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [buffer])

  if (failed) return <>{fallback ?? null}</>
  if (!deck) return <div className="fr-loading">正在解析幻灯片…</div>

  const total = deck.slides.reduce((sum, s) => sum + (s.shapes.length ? 1 : 0), 0)
  if (total === 0) return <>{fallback ?? null}</>

  return (
    <div className="fr-pptx">
      <div className="fr-page-heading">幻灯片 · 共 {deck.slides.length} 页</div>
      {deck.slides.map((slide, index) => (
        <div className="fr-pptx-slide" key={index}
          style={{
            aspectRatio: `${deck.width} / ${deck.height}`,
            ...(slide.bgImage ? { backgroundImage: `url(${slide.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : slide.bg ? { background: slide.bg } : {}),
          } as CSSProperties}>
          {slide.shapes.map((shape, i) => <PptxShapeView key={i} shape={shape} deck={deck} />)}
          <span className="fr-pptx-no">{index + 1}</span>
        </div>
      ))}
    </div>
  )
}

const toPercent = (v: number, total: number) => `${((v / total) * 100).toFixed(3)}%`
const toCqw = (v: number, total: number) => `${((v / total) * 100).toFixed(3)}cqw`

/** 画布测宽：用于把制表符推进到下一个制表位（设计稿 px） */
const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null
function measureText(text: string, fontPx: number, bold?: boolean): number {
  if (!measureCanvas || !text) return 0
  const ctx = measureCanvas.getContext('2d')
  if (!ctx) return 0
  ctx.font = `${bold ? '700 ' : ''}${fontPx}px "PingFang SC", "Microsoft YaHei", sans-serif`
  return ctx.measureText(text).width
}

/** PPT 默认制表间隔：1 英寸 = 96 设计 px */
const DEFAULT_TAB = 96

function ParaView({ para, deck }: { para: PptxPara; deck: PptxDeck }) {
  const style: CSSProperties = {
    textAlign: para.align ?? 'left',
    lineHeight: para.linePx ? toCqw(para.linePx, deck.width) : para.lineH ? String(para.lineH * 1.2) : 1.2,
    margin: 0,
    whiteSpace: 'pre-wrap',
  }
  if (para.marL) style.paddingLeft = toCqw(para.marL, deck.width)
  if (para.indent) style.textIndent = toCqw(para.indent, deck.width)
  if (para.spaceBefore != null) style.marginTop = toCqw(para.spaceBefore, deck.width)
  if (para.spaceAfter != null) style.marginBottom = toCqw(para.spaceAfter, deck.width)
  const nodes: ReactNode[] = []

  // 光标推进：渲染制表符时按文本实测宽度推进到下一个制表位
  const buildRunStyle = (run: PptxRun): CSSProperties => {
    const s: CSSProperties = {}
    if (run.size != null) s.fontSize = toCqw(run.size, deck.width)
    if (run.bold) s.fontWeight = 700
    if (run.italic) s.fontStyle = 'italic'
    if (run.color) s.color = run.color
    if (run.font) s.fontFamily = `"${run.font}", "PingFang SC", "Microsoft YaHei", sans-serif`
    return s
  }
  const pushRun = (run: PptxRun, i: number) => {
    const runStyle = buildRunStyle(run)
    const segs = run.text.split('\t')
    segs.forEach((seg, k) => {
      if (seg) {
        nodes.push(<span key={`${i}-${k}`} style={runStyle}>{seg}</span>)
        cursorX += measureText(seg, run.size ?? 24, run.bold)
      }
      if (k < segs.length - 1) {
        const stops = para.tabStops ?? []
        let next = stops.find((s) => s > cursorX + 1)
        if (next == null) next = (Math.floor(cursorX / DEFAULT_TAB) + 1) * DEFAULT_TAB
        const w = Math.max(0, next - cursorX)
        nodes.push(<span key={`${i}-tab-${k}`} style={{ display: 'inline-block', width: toCqw(w, deck.width) }} />)
        cursorX = next
      }
    })
  }

  let cursorX = (para.marL ?? 0) + Math.max(0, para.indent ?? 0)
  if (para.bullet) {
    nodes.push(<span key="bullet" style={{ marginRight: '0.35em', whiteSpace: 'pre' }}>{para.bullet}</span>)
    cursorX += measureText(para.bullet, 24) + 8
  } else if (para.number) {
    nodes.push(<span key="bullet" style={{ marginRight: '0.35em', whiteSpace: 'pre' }}>{`${para.number}.`}</span>)
    cursorX += measureText(`${para.number}.`, 24) + 8
  }
  para.runs.forEach((run, i) => {
    if (run.br) {
      nodes.push(<br key={i} />)
      cursorX = para.marL ?? 0
      return
    }
    if (run.text) pushRun(run, i)
    else {
      const s = buildRunStyle(run)
      nodes.push(<span key={i} style={s}>&nbsp;</span>)
      cursorX += measureText('\u00A0', run.size ?? 24)
    }
  })
  // 空段落占位（保留空段落行高）
  if (!nodes.length) {
    const size = para.runs[0]?.size ?? 24
    return <div style={{ ...style, fontSize: toCqw(size, deck.width) }}>&nbsp;</div>
  }
  return <div style={style}>{nodes}</div>
}

function PptxShapeView({ shape, deck }: { shape: PptxShape; deck: PptxDeck }) {
  const box: CSSProperties = {
    position: 'absolute',
    left: toPercent(shape.x, deck.width),
    top: toPercent(shape.y, deck.height),
    width: toPercent(shape.w, deck.width),
    height: toPercent(shape.h, deck.height),
  }
  if (shape.rot) box.transform = `rotate(${shape.rot}deg)`

  if (shape.kind === 'image') {
    return <img src={shape.src} alt="" style={{ ...box, objectFit: 'fill' }} draggable={false} />
  }

  if (shape.kind === 'table') {
    return (
      <div style={{
        ...box, display: 'grid',
        gridTemplateColumns: (shape.cols ?? []).map((w) => toPercent(w, shape.cols?.reduce((a, b) => a + b, 0) || 1)).join(' '),
        gridTemplateRows: (shape.rows ?? []).map((r) => toPercent(r.h, shape.rows?.reduce((a, b) => a + b.h, 0) || 1)).join(' '),
        background: '#FFFFFF',
      }}>
        {(shape.rows ?? []).flatMap((row, r) => row.cells.map((cell, c) => (
          <div key={`${r}-${c}`} style={{
            gridColumn: cell.span && cell.span > 1 ? `span ${cell.span}` : undefined,
            background: cell.fill && cell.fill !== 'transparent' ? cell.fill : undefined,
            border: '1px solid #d9d9d9',
            padding: toCqw(4, deck.width),
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}>
            {cell.paragraphs.map((para, i) => <ParaView key={i} para={para} deck={deck} />)}
          </div>
        )))}
      </div>
    )
  }

  const style: CSSProperties = {
    ...box,
    background: shape.fill && shape.fill !== 'transparent' ? shape.fill : undefined,
    borderRadius: shape.radius ? '0.6cqw' : undefined,
    // PowerPoint 文字允许溢出文本框，不裁剪
    overflow: shape.paragraphs?.length ? 'visible' : 'hidden',
    boxSizing: 'border-box',
  }
  if (shape.nowrap) style.whiteSpace = 'nowrap'
  if (shape.border) {
    style.border = `${toCqw(shape.border.width, deck.width)} solid ${shape.border.color}`
  }
  if (shape.paragraphs?.length) {
    style.display = 'flex'
    style.flexDirection = 'column'
    style.justifyContent = shape.anchor === 'center' ? 'center' : shape.anchor === 'bottom' ? 'flex-end' : 'flex-start'
    style.padding = `${toCqw(shape.padTop ?? 4, deck.width)} ${toCqw(shape.padX ?? 9, deck.width)} ${toCqw(shape.padBottom ?? 4, deck.width)}`
    style.wordBreak = 'break-word'
    style.overflowWrap = 'anywhere'
  }
  return (
    <div style={style}>
      {shape.paragraphs?.map((para, i) => <ParaView key={i} para={para} deck={deck} />)}
    </div>
  )
}

export interface FileReaderProps {
  fileData: string
  fileName: string
  fileType?: string
  /** embedded：作为知识库文档页内嵌；overlay：独立阅读弹层 */
  variant?: 'embedded' | 'overlay'
  onClose?: () => void
  onFullscreen?: () => void
  fullscreenLabel?: string
  className?: string
  /** 文档 ID：传入后 PDF/Word 支持手写批注，笔迹按此 ID 独立保存 */
  sketchKey?: string
}

/** 文档式文件阅读器：工作区内嵌与独立弹层共用同一套版面与解析逻辑。 */
export function FileReader({
  fileData, fileName, fileType = '', variant = 'overlay',
  onClose, onFullscreen, fullscreenLabel = '全屏阅读', className = '', sketchKey,
}: FileReaderProps) {
  const kind = useMemo(() => detectKind(fileName, fileType), [fileName, fileType])
  const { content, native, loading, error } = useParsedFile(fileData, kind)
  const [zoom, setZoom] = useState(1)
  const [sketching, setSketching] = useState(false)
  const canSketch = Boolean(sketchKey) && (kind === 'pdf' || kind === 'docx')

  useEffect(() => { setZoom(1); setSketching(false) }, [fileData, fileName])

  useEffect(() => {
    if (variant !== 'overlay') return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant, onClose])

  const title = fileName || '文件预览'
  const changeZoom = (delta: number) => setZoom((z) => Math.min(2.5, Math.max(0.5, Math.round((z + delta) * 100) / 100)))

  const toolbar = (
    <div className="fr-bar">
      <div className="fr-title">
        <Icon name="filetext" size={17} />
        <span className="fr-title-text">{title}</span>
        <span className="fr-kind">{KIND_LABEL[kind]}</span>
      </div>
      <div className="fr-actions">
        {fileData && <span className="fr-size">{formatBytes(fileData)}</span>}
        <div className="fr-zoom" aria-label="阅读缩放">
          <button className="fr-tool" onClick={() => changeZoom(-0.1)} title="缩小">−</button>
          <button className="fr-tool fr-zoom-value" onClick={() => setZoom(1)} title="恢复 100%">{Math.round(zoom * 100)}%</button>
          <button className="fr-tool" onClick={() => changeZoom(0.1)} title="放大">+</button>
        </div>
        {canSketch && (
          <button
            className={`fr-tool fr-tool-text${sketching ? ' active' : ''}`}
            onClick={() => setSketching((value) => !value)}
            title={sketching ? '退出手写' : '在原文档上手写'}
          >
            <Icon name="edit" size={15} /> {sketching ? '退出手写' : '手写'}
          </button>
        )}
        {onFullscreen && (
          <button className="fr-tool fr-tool-text" onClick={onFullscreen} title={fullscreenLabel}>
            <Icon name="expand" size={15} /> {fullscreenLabel}
          </button>
        )}
        {fileData && (
          <a className="fr-tool" href={fileData} download={fileName} title="下载文件"><Icon name="download" size={16} /></a>
        )}
        {onClose && (
          <button className="fr-tool" onClick={onClose} title="关闭（Esc）"><Icon name="x" size={18} /></button>
        )}
      </div>
    </div>
  )

  const body = (
    <div className="fr-scroll">
      {loading && <div className="fr-loading">正在解析文档…</div>}
      {error && <div className="fr-error">解析失败：{error}</div>}
      {!loading && !error && (
        <div className={`fr-paper${native ? ' fr-paper-office' : ''}${sketching ? ' fr-paper-sketching' : ''}`} style={{ '--fr-zoom': zoom } as CSSProperties}>
          {kind === 'pdf' ? (
            <iframe src={`${fileData}#toolbar=0&navpanes=0&view=FitH`} title={title} className="fr-frame" />
          ) : kind === 'image' ? (
            <img src={fileData} alt={title} className="fr-image" />
          ) : native ? (
            <OfficeRenderer request={native} />
          ) : content}
          {canSketch && sketchKey && (
            <DocSketch sketchKey={sketchKey} active={sketching} onExit={() => setSketching(false)} />
          )}
        </div>
      )}
    </div>
  )

  if (variant === 'embedded') {
    return <div className={`fr-embedded ${className}`.trim()}>{toolbar}{body}</div>
  }

  return (
    <div className="fr-overlay" role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}>
      <div className="fr-panel">{toolbar}{body}</div>
    </div>
  )
}

/** 兼容旧调用：独立阅读弹层 */
export default function FileViewer({ fileData, fileName, fileType, onClose }: {
  fileData: string
  fileName: string
  fileType?: string
  onClose: () => void
}) {
  return <FileReader fileData={fileData} fileName={fileName} fileType={fileType} variant="overlay" onClose={onClose} />
}

/** mammoth 生成的 HTML 消毒：保留 docx 图片 data-uri 与基本排版标签 */
function sanitizeMammothHtml(html: string): string {
  const allowed = /^(p|br|h[1-6]|strong|em|b|i|u|ul|ol|li|table|thead|tbody|tr|th|td|blockquote|img|span|div)$/
  return html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (full, tag: string, attrs: string) => {
    if (!allowed.test(tag.toLowerCase())) return ''
    const cleanAttrs = attrs
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s(?:href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, value: string) => {
        const raw = value.replace(/^['"]|['"]$/g, '')
        if (/^(data:image\/|https?:\/\/|\/|#)/i.test(raw)) return m
        return ''
      })
      .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, value: string) => {
        const raw = value.replace(/^['"]|['"]$/g, '')
        return /(?:url\s*\(|expression|javascript:)/i.test(raw) ? '' : m
      })
    return full.startsWith('</') ? `</${tag}>` : `<${tag}${cleanAttrs}>`
  })
}

/** SheetJS sheet_to_html 输出消毒，仅保留表格标签与基础属性 */
function sanitizeSheetHtml(html: string): string {
  return html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (full, tag: string, attrs: string) => {
    if (!/^(table|thead|tbody|tr|th|td|br|span|div|p)$/i.test(tag)) return ''
    const cleanAttrs = attrs
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\sstyle\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, value: string) => {
        const raw = value.replace(/^['"]|['"]$/g, '')
        return /(?:url\s*\(|expression|javascript:)/i.test(raw) ? '' : m
      })
    return full.startsWith('</') ? `</${tag}>` : `<${tag}${cleanAttrs}>`
  })
}
