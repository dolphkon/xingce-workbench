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

/** 从富文本中提取内嵌图片（DataURL），用于推送错题时并入 images */
export function extractImagesFromHtml(html: string): string[] {
  if (!html) return []
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return Array.from(doc.querySelectorAll('img'))
    .map((img) => img.getAttribute('src') ?? '')
    .filter((src) => src.startsWith('data:image/'))
}
