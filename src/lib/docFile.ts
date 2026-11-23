/** 文档上传工具：读取本地文件为 DataURL（PDF/图片）或纯文本（md/txt），供知识库在线阅读与下载。 */

export interface LoadedDocFile {
  title: string
  fileName: string
  fileType: string
  kind: 'md' | 'file'
  content: string
  fileData?: string
}

const TEXT_EXT = /\.(md|markdown|txt|text|csv|json|log|ini|yaml|yml)$/i

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

function baseName(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

/** 读取一个 File：文本类直接存 content；其余存 DataURL 在线预览 */
export function loadDocFile(file: File): Promise<LoadedDocFile> {
  return new Promise((resolve, reject) => {
    const isText = TEXT_EXT.test(file.name) || file.type.startsWith('text/')
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`读取「${file.name}」失败`))
    if (isText) {
      reader.onload = () => resolve({
        title: baseName(file.name),
        fileName: file.name,
        fileType: file.type || 'text/plain',
        kind: 'md',
        content: String(reader.result ?? ''),
      })
      reader.readAsText(file)
    } else {
      reader.onload = () => resolve({
        title: baseName(file.name),
        fileName: file.name,
        fileType: file.type || `application/${extOf(file.name)}`,
        kind: 'file',
        content: '',
        fileData: String(reader.result ?? ''),
      })
      reader.readAsDataURL(file)
    }
  })
}

/** 根据文件名/MIME 判断展示图标类型 */
export function docFileKind(fileName?: string, fileType?: string): 'pdf' | 'image' | 'text' | 'file' {
  const name = fileName ?? ''
  const type = fileType ?? ''
  if (/\.pdf$/i.test(name) || type === 'application/pdf') return 'pdf'
  if (/^image\//.test(type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return 'image'
  if (TEXT_EXT.test(name) || type.startsWith('text/')) return 'text'
  return 'file'
}

export function formatBytes(dataUrl?: string): string {
  if (!dataUrl) return ''
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return ''
  const b64 = dataUrl.slice(comma + 1)
  const bytes = Math.floor((b64.length * 3) / 4)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
