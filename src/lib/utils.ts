export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function daysAgo(ts: number): number {
  return Math.floor((Date.now() - ts) / 86_400_000)
}

export function pluralDays(ts: number): string {
  const days = daysAgo(ts)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  return `${days} 天前`
}

/** 按逗号、空格、换行分割标签并去重 */
export function parseTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,，\s\n]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  )
}

/**
 * 题干自动排版：清理 OCR／复制粘贴产生的多余空格，并把按图片宽度硬切的
 * 软换行合并为连续文本，由容器按自身宽度自动折行，避免右侧参差留白。
 * - 全角空格、制表符统一为普通空格
 * - 去除汉字之间、汉字与标点之间的多余空格（保留英文／数字内部空格）
 * - 单换行若非结构性分行（选项、序号、段落）则接到上一行；空行保留为段落
 */
export function formatQuestionText(input: string): string {
  if (!input) return ''
  const withWideSpaces = input
    .replace(/\r\n?/g, '\n')
    .replace(/[\u3000\t]+/g, ' ')

  // 汉字或中文标点（含全角引号、括号），这些字符之间的空格都属于冗余
  const cjkOrPunct = /([一-龥，。、；：？！）》」』】“”‘’…《「『（【()])\s+(?=[一-龥，。、；：？！）》」』】“”‘’…《「『（【()])/g

  const cleanedLines = withWideSpaces
    .split('\n')
    .map((line) => {
      let out = line.trim()
      // 汉字之间、汉字与中文标点之间、标点与标点之间的空格
      for (let i = 0; i < 3; i++) {
        const next = out.replace(cjkOrPunct, '$1')
        if (next === out) break
        out = next
      }
      // 数字/英文与全角括号之间的空格（如「9 (2019…）」）
      out = out.replace(/([A-Za-z0-9]) +([（(])/g, '$1$2')
      out = out.replace(/([）)]) +(?=[一-龥A-Za-z0-9])/g, '$1')
      // 中英文边界：多个空格收敛为一个，单个空格保留（如「分 2」）
      out = out.replace(/([一-龥])[ ]{2,}(?=[A-Za-z0-9])/g, '$1 ')
      out = out.replace(/([A-Za-z0-9])[ ]{2,}(?=[一-龥])/g, '$1 ')
      return out.replace(/[ ]{2,}/g, ' ')
    })

  // 结构性分行：下一行以选项/序号/段落标记开头时保留换行
  const isStructuralStart = (line: string) =>
    /^[A-Da-d][.．、：:）)]/.test(line) ||
    /^[①②③④⑤⑥⑦⑧⑨⑩]/.test(line) ||
    /^[（(][0-9一二三四五六七八九十]+[）)]/.test(line) ||
    /^[一二三四五六七八九十]+[、.]/.test(line) ||
    /^第[一二三四五六七八九十0-9]+[部分章节条]/.test(line) ||
    /^[0-9]+[.．、]/.test(line)

  const joinLine = (a: string, b: string) =>
    /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : a + b

  const merged: string[] = []
  for (const line of cleanedLines) {
    if (!line) {
      // 空行作为段落分隔，最多保留一个
      if (merged.length > 0 && merged[merged.length - 1] !== '') merged.push('')
      continue
    }
    const prev = merged[merged.length - 1]
    if (prev && !isStructuralStart(line)) {
      merged[merged.length - 1] = joinLine(prev, line)
    } else {
      merged.push(line)
    }
  }

  return merged
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim()
}
