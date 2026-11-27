/**
 * PDF 文本提取（按需加载 pdfjs-dist）。
 * 采用「文本层优先」策略：优先抽取 PDF 内嵌文本；扫描版无文本层时返回空串，
 * 由上层回退到逐页渲染 + OCR。每页之间用分页标记分隔，便于后续按题切分。
 */
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

import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null

function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
      return pdfjs
    }).catch((err) => { pdfjsPromise = null; throw err })
  }
  return pdfjsPromise
}

export interface PdfExtractResult {
  text: string
  pageCount: number
  /** 有文本层的页数 */
  textPages: number
}

/**
 * 提取 PDF 全文文本。返回 textPages=0 表示疑似扫描版，需要 OCR 回退。
 */
export async function extractPdfText(dataUrl: string): Promise<PdfExtractResult> {
  const buffer = decodeDataUrl(dataUrl)
  if (!buffer) throw new Error('PDF 数据解码失败')
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise
  const parts: string[] = []
  let textPages = 0
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo += 1) {
    const page = await doc.getPage(pageNo)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? String(item.str) : ''))
      .join(' ')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
    if (pageText) textPages += 1
    parts.push(pageText)
  }
  await doc.destroy()
  return { text: parts.join('\n\n'), pageCount: doc.numPages, textPages }
}

/**
 * 将 PDF 每页渲染为 PNG DataURL（用于扫描版 OCR 回退）。
 * maxPages 限制页数避免超大文件 OOM；scale 控制清晰度（1.5 左右兼顾速度与识别率）。
 */
export async function renderPdfPages(dataUrl: string, maxPages = 20, scale = 1.6): Promise<string[]> {
  const buffer = decodeDataUrl(dataUrl)
  if (!buffer) throw new Error('PDF 数据解码失败')
  const pdfjs = await loadPdfjs()
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise
  const count = Math.min(doc.numPages, maxPages)
  const pages: string[] = []
  for (let pageNo = 1; pageNo <= count; pageNo += 1) {
    const page = await doc.getPage(pageNo)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    await page.render({ canvasContext: ctx, viewport }).promise
    pages.push(canvas.toDataURL('image/png'))
  }
  await doc.destroy()
  return pages
}
