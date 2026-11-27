/**
 * 题库材料富文本工具。
 *
 * 数据兼容策略：BankQuestion.material 继续保存纯文本（LLM 拆题、搜索、推送错题都用），
 * 新增 materialHtml 保存带排版与内嵌图片的富文本。老题目没有 materialHtml 时，
 * 由 plainToRichText 从纯文本生成，不改动既有数据。
 */
import DOMPurify from 'dompurify'

const ALLOWED_TAGS = ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'ul', 'ol', 'li', 'span', 'img']
const ALLOWED_ATTR = ['style', 'src', 'alt', 'width', 'height', 'class', 'data-w', 'contenteditable']

/** 过滤危险标签/属性，同时放行 base64 内嵌图片 */
export function sanitizeRichHtml(html: string): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ADD_DATA_URI_TAGS: ['img'],
    ALLOW_DATA_ATTR: true,
  })
}

/**
 * 预览专用清洗：在 sanitizeRichHtml 基础上移除编辑器控件与固定图片尺寸。
 * 保存的 HTML 保留 rt-handle/rt-remove，编辑时仍可拖拽/删除；
 * 但列表预览若直接渲染会被红色 × 覆盖、固定 width + max-height 会把图压扁，
 * 因此预览时去掉这些控件和宽高属性，交由 CSS 等比缩放。
 */
export function richHtmlForPreview(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(sanitizeRichHtml(html), 'text/html')
  doc.querySelectorAll('.rt-handle, .rt-remove').forEach((node) => node.remove())
  doc.querySelectorAll('[contenteditable]').forEach((node) => node.removeAttribute('contenteditable'))
  doc.querySelectorAll('.rt-image').forEach((node) => node.replaceWith(...Array.from(node.childNodes)))
  doc.querySelectorAll('img').forEach((img) => {
    img.removeAttribute('width')
    img.removeAttribute('height')
    img.removeAttribute('style')
    img.removeAttribute('data-w')
  })
  return doc.body.innerHTML
}

/** 富文本 → 纯文本：图片替换为「[图]」占位，保留段落换行 */
export function richTextToPlain(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // 编辑器控件（删除按钮 × / 缩放手柄）不进入纯文本
  doc.querySelectorAll('.rt-remove, .rt-handle').forEach((node) => node.remove())
  doc.querySelectorAll('img').forEach((img) => {
    const mark = doc.createTextNode('[图]')
    img.replaceWith(mark)
  })
  return (doc.body.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 纯文本 → 富文本：按换行包成段落，HTML 特殊字符转义 */
export function plainToRichText(text: string): string {
  if (!text) return ''
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return escaped.split('\n').map((line) => `<p>${line || '<br>'}</p>`).join('')
}

/** 从富文本中提取内嵌图片（DataURL，原始尺寸） */
export function extractImagesFromHtml(html: string): string[] {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll('img'))
    .map((img) => img.getAttribute('src') ?? '')
    .filter((src) => src.startsWith('data:image/'))
}

/** 读取图片在编辑器里被拖拽后的显示宽度：data-w → width 属性 → style.width */
function displayWidthOf(img: HTMLImageElement): number {
  const fromData = Number(img.getAttribute('data-w'))
  if (fromData > 0) return fromData
  const fromAttr = Number(img.getAttribute('width'))
  if (fromAttr > 0) return fromAttr
  const fromStyle = Number((img.style.width || '').replace(/px/i, ''))
  return fromStyle > 0 ? fromStyle : 0
}

/**
 * 按「用户在编辑器里缩放后的显示宽度」重绘内嵌图片，用于推送错题。
 * 根因：编辑器拖拽只改了 img 的 data-w/width/style，src 仍是压缩后的大图（可达 3200px），
 * 直接提取会让错题详情里的图片按原始尺寸撑满、严重失衡。
 * 这里把每张图重绘到显示宽度（不超过原图宽度，避免糊），保证题库与错题详情视觉一致。
 */
export function extractImagesAtDisplaySize(html: string): Promise<string[]> {
  if (!html) return Promise.resolve([])
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const jobs = Array.from(doc.querySelectorAll('img'))
    .filter((img) => (img.getAttribute('src') ?? '').startsWith('data:image/'))
    .map((img) => new Promise<string>((resolve) => {
      const src = img.getAttribute('src') as string
      const target = displayWidthOf(img)
      const image = new Image()
      image.onload = () => {
        // 无缩放记录或目标不小于原图：直接返回原图，避免重绘损失清晰度
        if (!target || target >= image.naturalWidth) return resolve(src)
        const canvas = document.createElement('canvas')
        canvas.width = target
        canvas.height = Math.max(1, Math.round(image.naturalHeight * (target / image.naturalWidth)))
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(src)
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        const lossless = src.startsWith('data:image/png')
        resolve(canvas.toDataURL(lossless ? 'image/png' : 'image/jpeg', 0.95))
      }
      image.onerror = () => resolve(src)
      image.src = src
    }))
  return Promise.all(jobs)
}
