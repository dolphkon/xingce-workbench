/** 自研 PPTX 版式解析器：直接读取 OOXML，按幻灯片原始坐标渲染形状/文本/图片/表格，
 *  替代第三方预览库的粗略排版，保证与原文件版式一致。 */
import JSZip from 'jszip'

export interface PptxRun {
  text: string
  br?: boolean
  size?: number // 设计稿 px
  bold?: boolean
  italic?: boolean
  color?: string
  font?: string
}

export interface PptxPara {
  runs: PptxRun[]
  align?: 'left' | 'center' | 'right' | 'justify'
  lineH?: number // 倍数行距（相对单倍行距，渲染时乘以字体自然行高系数）
  linePx?: number // 固定行距（设计 px）
  bullet?: string
  number?: number // 自动编号序号
  spaceBefore?: number
  spaceAfter?: number
  marL?: number // 段落左缩进（设计 px）
  indent?: number // 首行缩进（设计 px，可为负实现悬挂缩进）
  tabStops?: number[] // 显式制表位（设计 px）
}

export interface PptxShape {
  kind: 'shape' | 'image' | 'table'
  x: number
  y: number
  w: number
  h: number // 设计稿 px
  rot?: number // 度
  fill?: string
  radius?: boolean
  border?: { width: number; color: string }
  anchor?: 'top' | 'center' | 'bottom'
  padX?: number
  padTop?: number
  padBottom?: number
  nowrap?: boolean
  paragraphs?: PptxPara[]
  src?: string
  cols?: number[] // 表格列宽（设计 px）
  rows?: { h: number; cells: { fill?: string; paragraphs: PptxPara[]; span?: number }[] }[]
}

export interface PptxSlideData {
  shapes: PptxShape[]
  /** 背景色（slide → layout → master 逐级继承） */
  bg?: string
  /** 背景图（cover 铺满） */
  bgImage?: string
}

export interface PptxDeck {
  width: number
  height: number
  slides: PptxSlideData[]
}

const EMU_PER_PX = 9525 // 96dpi

const SCHEME_COLORS: Record<string, string> = {
  dk1: '000000', tx1: '000000', lt1: 'FFFFFF', bg1: 'FFFFFF',
  dk2: '44546A', tx2: '44546A', lt2: 'E7E6E6', bg2: 'E7E6E6',
  accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000',
  accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72',
  phClr: '000000',
}

function kids(el: Element, local: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === local)
}
function kid(el: Element | null | undefined, local: string): Element | null {
  if (!el) return null
  return kids(el, local)[0] ?? null
}
function desc(el: Element, local: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', local))
}
function num(el: Element | null | undefined, attr: string): number | undefined {
  const v = el?.getAttribute(attr)
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
const emu2px = (emu: number) => emu / EMU_PER_PX

/** 解析 solidFill 颜色（srgbClr / schemeClr） */
function fillColor(el: Element | null | undefined): string | undefined {
  if (!el) return undefined
  for (const child of el.children) {
    if (child.localName === 'noFill') return 'transparent'
    if (child.localName === 'solidFill') {
      const srgb = kid(child, 'srgbClr')
      if (srgb) return `#${srgb.getAttribute('val')}`
      const scheme = kid(child, 'schemeClr')
      if (scheme) {
        const base = SCHEME_COLORS[scheme.getAttribute('val') ?? '']
        if (base) return `#${base}`
      }
      return undefined
    }
    // gradFill 等复杂填充：取第一个渐变色近似
    if (child.localName === 'gradFill') {
      const stop = kid(child, 'gsLst')?.children[0]
      const srgb = stop ? desc(stop, 'srgbClr')[0] : null
      if (srgb) return `#${srgb.getAttribute('val')}`
      return undefined
    }
  }
  return undefined
}

/** rPr / defRPr → 文字样式 */
function runStyle(pr: Element | null | undefined): Partial<PptxRun> {
  const style: Partial<PptxRun> = {}
  if (!pr) return style
  const sz = num(pr, 'sz')
  if (sz != null) style.size = (sz / 100) * (96 / 72)
  const b = pr.getAttribute('b')
  if (b === '1' || b === 'true') style.bold = true
  const i = pr.getAttribute('i')
  if (i === '1' || i === 'true') style.italic = true
  const color = fillColor(pr)
  if (color && color !== 'transparent') style.color = color
  const latin = kid(pr, 'latin')?.getAttribute('typeface')
  const ea = kid(pr, 'ea')?.getAttribute('typeface')
  const font = latin || ea
  if (font && !/^\+/.test(font)) style.font = font
  return style
}

function parseParagraph(p: Element, defaults: Partial<PptxRun>): PptxPara {
  const para: PptxPara = { runs: [] }
  const pPr = kid(p, 'pPr')
  if (pPr) {
    const algn = pPr.getAttribute('algn')
    para.align = algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' || algn === 'dist' ? 'justify' : 'left'
    const spcPct = desc(pPr, 'spcPct')[0]
    const spcPts = desc(pPr, 'spcPts')[0]
    if (spcPct) para.lineH = (num(spcPct, 'val') ?? 100000) / 100000
    if (spcPts) para.linePx = ((num(spcPts, 'val') ?? 1800) / 100) * (96 / 72)
    const spcBef = kid(pPr, 'spcBef')
    const spcAft = kid(pPr, 'spcAft')
    if (spcBef) {
      const pts = desc(spcBef, 'spcPts')[0]
      if (pts) para.spaceBefore = ((num(pts, 'val') ?? 0) / 100) * (96 / 72)
    }
    if (spcAft) {
      const pts = desc(spcAft, 'spcPts')[0]
      if (pts) para.spaceAfter = ((num(pts, 'val') ?? 0) / 100) * (96 / 72)
    }
    const marL = num(pPr, 'marL')
    const indent = num(pPr, 'indent')
    if (marL) para.marL = emu2px(marL)
    if (indent) para.indent = emu2px(indent)
    const tabLst = kid(pPr, 'tabLst')
    const stops = tabLst ? kids(tabLst, 'tab').map((t) => num(t, 'pos')).filter((v): v is number => v != null).map(emu2px) : []
    if (stops.length) para.tabStops = stops
    const buChar = kid(pPr, 'buChar')?.getAttribute('char')
    const buNone = kid(pPr, 'buNone')
    const buAuto = kid(pPr, 'buAutoNum')
    if (buChar) para.bullet = buChar || '•'
    else if (buAuto) para.number = 0 // 哨兵值，由 parseTxBody 统一编号
    else if (!buNone && (kid(pPr, 'buClr') || kid(pPr, 'buSzPct'))) para.bullet = '•'
    const def = kid(pPr, 'defRPr')
    Object.assign(defaults, runStyle(def))
  }
  // endParaRPr 描述段落结束标记的样式：作为本段字号兜底（空段落行高完全取决于它）
  const endDefaults: Partial<PptxRun> = { ...defaults, ...runStyle(kid(p, 'endParaRPr')) }
  for (const node of Array.from(p.children)) {
    if (node.localName === 'r') {
      const rPr = runStyle(kid(node, 'rPr'))
      // 无 sz 的运行回退到 endParaRPr / defRPr，避免错误的 18pt 默认值
      if (rPr.size == null && endDefaults.size != null) rPr.size = endDefaults.size
      const style = { ...defaults, ...endDefaults, ...rPr, size: rPr.size ?? endDefaults.size }
      const t = kid(node, 't')
      const text = t?.textContent ?? ''
      if (text) para.runs.push({ text, ...style, size: style.size })
    } else if (node.localName === 'br') {
      para.runs.push({ text: '', br: true, ...runStyle(kid(node, 'rPr')) })
    } else if (node.localName === 'fld') {
      const style = { ...defaults, ...endDefaults, ...runStyle(kid(node, 'rPr')) }
      const t = kid(node, 't')
      if (t?.textContent) para.runs.push({ text: t.textContent, ...style })
    }
  }
  // 空段落：用 endParaRPr 的字号撑起正确行高
  if (!para.runs.length) {
    const style = { ...endDefaults }
    if (style.size == null) style.size = 18 * (96 / 72)
    para.runs.push({ text: '', ...style })
  }
  return para
}

function parseTxBody(txBody: Element | null): { paragraphs: PptxPara[]; anchor: PptxShape['anchor']; padX: number; padTop: number; padBottom: number; nowrap?: boolean } {
  const paragraphs: PptxPara[] = []
  let anchor: PptxShape['anchor'] = 'top'
  let padX = 91440 / EMU_PER_PX
  let padTop = 45720 / EMU_PER_PX
  let padBottom = 45720 / EMU_PER_PX
  let nowrap = false
  if (!txBody) return { paragraphs, anchor, padX, padTop, padBottom }
  const bodyPr = kid(txBody, 'bodyPr')
  if (bodyPr) {
    const a = bodyPr.getAttribute('anchor')
    anchor = a === 'ctr' ? 'center' : a === 'b' ? 'bottom' : 'top'
    const lIns = num(bodyPr, 'lIns'), rIns = num(bodyPr, 'rIns')
    const tIns = num(bodyPr, 'tIns'), bIns = num(bodyPr, 'bIns')
    if (lIns != null) padX = emu2px(lIns)
    if (rIns != null) padX = Math.max(padX, emu2px(rIns))
    if (tIns != null) padTop = emu2px(tIns)
    if (bIns != null) padBottom = emu2px(bIns)
    if (bodyPr.getAttribute('wrap') === 'none') { padX += 2; nowrap = true }
  }
  const defaults: Partial<PptxRun> = { size: 18 * (96 / 72), color: '#000000' }
  for (const p of kids(txBody, 'p')) paragraphs.push(parseParagraph(p, defaults))
  // 自动编号：连续段落逐项递增，遇普通段落重新计数
  let counter = 0
  for (const p of paragraphs) {
    if (p.number === 0) p.number = ++counter
    else if (p.number != null) counter = p.number
    else counter = 0
  }
  return { paragraphs, anchor, padX, padTop, padBottom, nowrap }
}

/** 组合形状缩放：内部文字与内边距随组同步缩放 */
function scaleParas(paras: PptxPara[], f: number) {
  if (f === 1) return paras
  for (const p of paras) {
    if (p.linePx) p.linePx *= f
    if (p.spaceBefore) p.spaceBefore *= f
    if (p.spaceAfter) p.spaceAfter *= f
    for (const r of p.runs) if (r.size) r.size *= f
  }
  return paras
}

function parseXfrm(owner: Element | null): { x: number; y: number; w: number; h: number; rot?: number } | null {
  const xfrm = owner ? (kid(owner, 'spPr') ? kid(kid(owner, 'spPr'), 'xfrm') : kid(kid(owner, 'grpSpPr'), 'xfrm') ?? kid(owner, 'xfrm')) : null
  const real = xfrm ?? (owner ? desc(owner, 'xfrm')[0] ?? null : null)
  if (!real) return null
  const off = kid(real, 'off')
  const ext = kid(real, 'ext')
  if (!off || !ext) return null
  const x = num(off, 'x'), y = num(off, 'y')
  const w = num(ext, 'cx'), h = num(ext, 'cy')
  if (x == null || y == null || w == null || h == null) return null
  const rot = num(real, 'rot')
  return { x: emu2px(x), y: emu2px(y), w: emu2px(w), h: emu2px(h), rot: rot ? rot / 60000 : undefined }
}

function phKey(sp: Element): { type: string; idx: string } | null {
  const ph = desc(sp, 'ph')[0]
  if (!ph) return null
  return { type: ph.getAttribute('type') ?? '', idx: ph.getAttribute('idx') ?? '' }
}

interface XfrmSource { get: (key: { type: string; idx: string }) => { x: number; y: number; w: number; h: number } | null }

/** 解析一组形状（支持 p:grpSp 递归与坐标映射） */
function parseShapeTree(
  tree: Element,
  images: Map<string, string>,
  layoutXfrm: XfrmSource,
  mapPoint: (x: number, y: number) => { x: number; y: number } = (x, y) => ({ x, y }),
  scale: (v: number) => number = (v) => v,
): PptxShape[] {
  const shapes: PptxShape[] = []
  for (const node of Array.from(tree.children)) {
    const local = node.localName
    if (local === 'sp') {
      let box = parseXfrm(node)
      const key = phKey(node)
      if (!box && key) box = layoutXfrm.get(key) ?? undefined as never
      if (!box) continue
      const pos = mapPoint(box.x, box.y)
      const txBody = kid(node, 'txBody')
      const spPr = kid(node, 'spPr')
      const fill = fillColor(spPr)
      const ln = kid(spPr, 'ln')
      let border: PptxShape['border']
      if (ln && ln.getAttribute('w') && fillColor(ln)) {
        border = {
          width: Math.max(1, emu2px(num(ln, 'w') ?? 12700)),
          color: fillColor(ln) ?? '#000000',
        }
      }
      const geom = kid(spPr, 'prstGeom')?.getAttribute('prst')
      const body = parseTxBody(txBody)
      const factor = scale(1)
      scaleParas(body.paragraphs, factor)
      const hasText = body.paragraphs.some((p) => p.runs.some((r) => r.text.trim()))
      if (!hasText && !fill && !border && geom !== 'rect' && geom !== 'roundRect' && geom !== 'ellipse') continue
      shapes.push({
        kind: 'shape', x: pos.x, y: pos.y, w: scale(box.w), h: scale(box.h), rot: box.rot,
        fill: fill === 'transparent' ? undefined : fill,
        radius: geom === 'roundRect' || geom === 'ellipse',
        border, anchor: body.anchor,
        padX: body.padX * factor, padTop: body.padTop * factor, padBottom: body.padBottom * factor,
        nowrap: body.nowrap,
        paragraphs: hasText ? body.paragraphs : undefined,
      })
    } else if (local === 'pic') {
      const box = parseXfrm(node)
      const blip = desc(node, 'blip')[0]
      const rid = blip?.getAttribute('r:embed') ?? blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
      const src = rid ? images.get(rid) : undefined
      if (!box || !src) continue
      const pos = mapPoint(box.x, box.y)
      shapes.push({ kind: 'image', x: pos.x, y: pos.y, w: scale(box.w), h: scale(box.h), rot: box.rot, src })
    } else if (local === 'graphicFrame') {
      const box = parseXfrm(node)
      const tbl = desc(node, 'tbl')[0]
      if (!box || !tbl) continue
      const pos = mapPoint(box.x, box.y)
      const cols = kids(kid(tbl, 'tblGrid') ?? tbl, 'gridCol').map((c) => emu2px(num(c, 'w') ?? 0))
      const rows = kids(tbl, 'tr').map((tr) => ({
        h: emu2px(num(tr, 'h') ?? 0),
        cells: kids(tr, 'tc').map((tc) => {
          const tcPr = kid(tc, 'tcPr')
          const cell = parseTxBody(kid(tc, 'txBody'))
          return { fill: fillColor(tcPr), paragraphs: cell.paragraphs, span: num(tc, 'gridSpan') }
        }),
      }))
      shapes.push({ kind: 'table', x: pos.x, y: pos.y, w: scale(box.w), h: scale(box.h), cols, rows })
    } else if (local === 'grpSp') {
      const xfrm = kid(kid(node, 'grpSpPr'), 'xfrm')
      const off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext')
      const chOff = kid(xfrm, 'chOff'), chExt = kid(xfrm, 'chExt')
      if (!off || !ext || !chOff || !chExt) continue
      const gx = emu2px(num(off, 'x') ?? 0), gy = emu2px(num(off, 'y') ?? 0)
      const sx = (num(ext, 'cx') ?? 1) / Math.max(1, num(chExt, 'cx') ?? 1)
      const sy = (num(ext, 'cy') ?? 1) / Math.max(1, num(chExt, 'cy') ?? 1)
      const cx = emu2px(num(chOff, 'x') ?? 0), cy = emu2px(num(chOff, 'y') ?? 0)
      const inner = parseShapeTree(node, images, layoutXfrm,
        (x, y) => mapPoint(gx + (x - cx) * sx, gy + (y - cy) * sy),
        (v) => scale(v * (Math.abs(sx - 1) > 0.01 ? sx : 1)),
      )
      shapes.push(...inner)
    }
  }
  return shapes
}

async function loadRels(zip: JSZip, partPath: string): Promise<Map<string, string>> {
  const dir = partPath.split('/').slice(0, -1).join('/')
  const relPath = `${dir}/_rels/${partPath.split('/').pop()}.rels`
  const file = zip.file(relPath)
  const rels = new Map<string, string>()
  if (!file) return rels
  const xml = await file.async('string')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  for (const rel of desc(doc.documentElement, 'Relationship')) {
    const id = rel.getAttribute('Id')
    let target = rel.getAttribute('Target') ?? ''
    if (!id) continue
    if (target.startsWith('/') ) target = target.slice(1)
    else if (!target.startsWith('ppt/')) target = target.replace(/^\.\.\//, 'ppt/').replace(/^\.\//, `${dir}/`)
    rels.set(id, target)
  }
  return rels
}

/** 从 layout/master 文档收集占位符几何信息（layout 优先于 master） */
function collectPhXfrm(doc: Document, into: Map<string, { x: number; y: number; w: number; h: number }>) {
  for (const sp of desc(doc.documentElement, 'sp')) {
    const box = parseXfrm(sp)
    const key = phKey(sp)
    if (!box || !key) continue
    for (const k of [`${key.type}|${key.idx}`, `|${key.idx}`, `${key.type}|`]) {
      if (!into.has(k)) into.set(k, { x: box.x, y: box.y, w: box.w, h: box.h })
    }
  }
}

interface PartInfo {
  shapes: PptxShape[]
  bg?: string
  bgImage?: string
  showMasterSp: boolean
}

/** 解析 p:bg 元素：优先背景图，其次纯色 */
function readBg(bg: Element | null, images: Map<string, string>): { bg?: string; bgImage?: string } {
  if (!bg) return {}
  const bgPr = kid(bg, 'bgPr')
  if (bgPr) {
    const blip = desc(bgPr, 'blip')[0]
    const rid = blip?.getAttribute('r:embed') ?? blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed')
    const img = rid ? images.get(rid) : undefined
    if (img) return { bgImage: img }
    const color = fillColor(bgPr)
    if (color && color !== 'transparent') return { bg: color }
    return {}
  }
  const bgRef = kid(bg, 'bgRef')
  if (bgRef) {
    const srgb = kid(bgRef, 'srgbClr')
    const scheme = kid(bgRef, 'schemeClr')
    const val = srgb ? srgb.getAttribute('val') : scheme ? SCHEME_COLORS[scheme.getAttribute('val') ?? ''] : undefined
    if (val) return { bg: `#${val.replace('#', '')}` }
  }
  return {}
}

/** 解析单个 OOXML part 的形状树（母版/版式用：跳过占位符，只保留装饰元素与背景） */
async function loadPart(zip: JSZip, path: string): Promise<PartInfo | null> {
  const file = zip.file(path)
  if (!file) return null
  try {
    const rels = await loadRels(zip, path)
    const images = new Map<string, string>()
    for (const [rid, target] of rels) {
      if (!/ppt\/media\//.test(target)) continue
      const media = zip.file(target)
      if (!media) continue
      const base64 = await media.async('base64')
      const ext = (target.split('.').pop() ?? 'png').toLowerCase()
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext
      images.set(rid, `data:image/${mime};base64,${base64}`)
    }
    const doc = new DOMParser().parseFromString(await file.async('string'), 'application/xml')
    const root = doc.documentElement
    const cSld = kid(root, 'cSld')
    const spTree = kid(cSld, 'spTree')
    // 占位符只是几何模板，母版/版式中不实际渲染；一次性解析整棵树，避免重复渲染装饰元素
    const shapes: PptxShape[] = []
    if (spTree) {
      const decorationOnly = document.implementation.createDocument('http://www.w3.org/1999/xhtml', 'root', null)
      const wrapper = decorationOnly.documentElement
      for (const node of Array.from(spTree.children)) {
        if (['sp', 'pic', 'graphicFrame', 'grpSp'].includes(node.localName) && phKey(node)) continue
        wrapper.appendChild(node.cloneNode(true))
      }
      if (wrapper.childNodes.length) {
        shapes.push(...parseShapeTree(wrapper as unknown as Element, images, { get: () => null }))
      }
    }
    const info: PartInfo = { shapes, showMasterSp: root.getAttribute('showMasterSp') !== '0', ...readBg(kid(cSld, 'bg'), images) }
    return info
  } catch { return null }
}

/** 解析整个 PPTX：返回设计稿尺寸与每页形状（坐标为 96dpi 像素） */
export async function parsePptxDeck(buffer: ArrayBuffer): Promise<PptxDeck> {
  const zip = await JSZip.loadAsync(buffer)
  const presFile = zip.file('ppt/presentation.xml')
  let width = 1280
  let height = 720
  if (presFile) {
    const doc = new DOMParser().parseFromString(await presFile.async('string'), 'application/xml')
    const sldSz = desc(doc.documentElement, 'sldSz')[0]
    if (sldSz) {
      width = emu2px(num(sldSz, 'cx') ?? 12192000)
      height = emu2px(num(sldSz, 'cy') ?? 6858000)
    }
  }

  // 幻灯片顺序按 presentation.xml 的 sldIdLst
  let slidePaths: string[] = []
  const allSlides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/slide(\d+)\.xml/.exec(a)?.[1]) - Number(/slide(\d+)\.xml/.exec(b)?.[1]))
  if (presFile) {
    try {
      const rels = await loadRels(zip, 'ppt/presentation.xml')
      const doc = new DOMParser().parseFromString(await presFile.async('string'), 'application/xml')
      const ordered: string[] = []
      for (const sldId of desc(doc.documentElement, 'sldId')) {
        const rid = sldId.getAttribute('r:id') ?? sldId.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
        const target = rid ? rels.get(rid) : null
        if (target && zip.file(target)) ordered.push(target)
      }
      slidePaths = ordered.length ? ordered : allSlides
    } catch { slidePaths = allSlides }
  } else {
    slidePaths = allSlides
  }

  const partCache = new Map<string, PartInfo | null>()
  const loadCached = async (path: string) => {
    if (!partCache.has(path)) partCache.set(path, await loadPart(zip, path))
    return partCache.get(path) ?? null
  }

  const slides: PptxSlideData[] = []
  for (const path of slidePaths) {
    const file = zip.file(path)
    if (!file) continue
    const xml = await file.async('string')
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    const rels = await loadRels(zip, path)
    const images = new Map<string, string>()
    for (const [rid, target] of rels) {
      if (!/ppt\/media\//.test(target)) continue
      const media = zip.file(target)
      if (!media) continue
      const base64 = await media.async('base64')
      const ext = (target.split('.').pop() ?? 'png').toLowerCase()
      const mime = ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext
      images.set(rid, `data:image/${mime};base64,${base64}`)
    }
    // layout → master 几何与装饰继承
    const layoutPath = Array.from(rels.values()).find((t) => t.includes('slideLayouts/slideLayout'))
    const layout = layoutPath ? await loadCached(layoutPath) : null
    const masterPath = layoutPath ? Array.from((await loadRels(zip, layoutPath)).values()).find((t) => t.includes('slideMasters/slideMaster')) : undefined
    const master = masterPath ? await loadCached(masterPath) : null

    // 占位符几何：layout 覆盖 master
    const phMap = new Map<string, { x: number; y: number; w: number; h: number }>()
    if (masterPath) {
      const mfile = zip.file(masterPath)
      if (mfile) {
        try {
          const mdoc = new DOMParser().parseFromString(await mfile.async('string'), 'application/xml')
          collectPhXfrm(mdoc, phMap)
        } catch { /* ignore */ }
      }
    }
    if (layoutPath) {
      const lfile = zip.file(layoutPath)
      if (lfile) {
        try {
          const ldoc = new DOMParser().parseFromString(await lfile.async('string'), 'application/xml')
          collectPhXfrm(ldoc, phMap)
        } catch { /* ignore */ }
      }
    }
    const layoutXfrm: XfrmSource = { get: (key) => phMap.get(`${key.type}|${key.idx}`) ?? phMap.get(`|${key.idx}`) ?? phMap.get(`${key.type}|`) ?? null }

    const spTree = desc(doc.documentElement, 'cSld')[0] ? kid(desc(doc.documentElement, 'cSld')[0], 'spTree') : null
    const shapes = spTree ? parseShapeTree(spTree, images, layoutXfrm) : []

    // 背景继承：slide → layout → master；slide 明确 showMasterSp="0" 时跳过母版装饰
    const useMaster = doc.documentElement.getAttribute('showMasterSp') !== '0' && (layout?.showMasterSp ?? true)
    const slideData: PptxSlideData = {
      shapes: [
        ...(useMaster && master ? master.shapes : []),
        ...(layout?.shapes ?? []),
        ...shapes,
      ],
      bg: undefined,
      bgImage: undefined,
    }
    const inherit = (info: { bg?: string; bgImage?: string } | null | undefined) => {
      if (!info) return
      if (!slideData.bgImage && info.bgImage) slideData.bgImage = info.bgImage
      if (!slideData.bg && !slideData.bgImage && info.bg) slideData.bg = info.bg
    }
    // slide 自身背景优先
    const slideC = kid(doc.documentElement, 'cSld')
    Object.assign(slideData, readBg(kid(slideC, 'bg'), images))
    inherit(layout)
    inherit(master)
    slides.push(slideData)
  }
  return { width, height, slides }
}
