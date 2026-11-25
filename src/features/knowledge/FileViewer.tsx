/** 应用内文件阅读器：统一用于知识库文件文档、全屏阅读与附件预览。
 *  采用「文档页」式版面（纸张、页边距、缩放、工具栏），支持 PDF / 图片 /
 *  DOCX / XLSX / PPTX / Markdown / TXT / CSV / JSON 等常见格式。 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { Icon } from '../../components/ui'
import { renderMarkdown } from '../../lib/markdown'
import { formatBytes } from '../../lib/docFile'

type PreviewKind = 'pdf' | 'image' | 'text' | 'markdown' | 'csv' | 'docx' | 'xlsx' | 'pptx' | 'unknown'

interface SlideData { text: string[]; images: string[] }

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      setLoading(true); setError(null); setContent(null)
      try {
        if (kind === 'pdf' || kind === 'image') {
          if (!cancelled) setLoading(false)
          return
        }
        const buffer = decodeDataUrl(fileData)
        if (!buffer) throw new Error('文件数据无效')
        if (kind === 'docx') {
          const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
          if (!cancelled) setContent(<div className="fr-rich" dangerouslySetInnerHTML={{ __html: sanitizeMammothHtml(result.value) }} />)
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
          const slides = await parsePptx(buffer)
          if (!cancelled) setContent(
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
            </div>,
          )
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

  return { content, loading, error }
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
}

/** 文档式文件阅读器：工作区内嵌与独立弹层共用同一套版面与解析逻辑。 */
export function FileReader({
  fileData, fileName, fileType = '', variant = 'overlay',
  onClose, onFullscreen, fullscreenLabel = '全屏阅读', className = '',
}: FileReaderProps) {
  const kind = useMemo(() => detectKind(fileName, fileType), [fileName, fileType])
  const { content, loading, error } = useParsedFile(fileData, kind)
  const [zoom, setZoom] = useState(1)

  useEffect(() => { setZoom(1) }, [fileData, fileName])

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
        <div className="fr-paper" style={{ '--fr-zoom': zoom } as CSSProperties}>
          {kind === 'pdf' ? (
            <iframe src={`${fileData}#toolbar=0&navpanes=0&view=FitH`} title={title} className="fr-frame" />
          ) : kind === 'image' ? (
            <img src={fileData} alt={title} className="fr-image" />
          ) : content}
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
