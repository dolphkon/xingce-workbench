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
