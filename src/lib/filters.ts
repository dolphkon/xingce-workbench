/** 错题库筛选条件：正确率区间与录入时间范围（错题库与专项刷题共用） */

export const ACCURACY_RANGES = [
  { value: 'lt30', label: '30% 以下' },
  { value: '30to50', label: '30%-50%' },
  { value: '50to60', label: '50%-60%' },
  { value: '60to70', label: '60%-70%' },
  { value: 'gte70', label: '70% 以上' },
] as const

export type AccuracyRange = 'all' | (typeof ACCURACY_RANGES)[number]['value']

export function isAccuracyRange(value: string | null): value is AccuracyRange {
  return value === 'all' || ACCURACY_RANGES.some((range) => range.value === value)
}

/** 区间左闭右开：30%-50% 表示 30 <= x < 50；未设置正确率的题目不匹配任何区间 */
export function matchesAccuracy(accuracy: number | undefined | null, range: AccuracyRange): boolean {
  if (range === 'all') return true
  if (accuracy == null) return false
  switch (range) {
    case 'lt30': return accuracy < 30
    case '30to50': return accuracy >= 30 && accuracy < 50
    case '50to60': return accuracy >= 50 && accuracy < 60
    case '60to70': return accuracy >= 60 && accuracy < 70
    case 'gte70': return accuracy >= 70
    default: return true
  }
}

export type DateRange = 'all' | '7' | '30' | 'custom'

export function isDateRange(value: string | null): value is DateRange {
  return value === 'all' || value === '7' || value === '30' || value === 'custom'
}

/** 按 YYYY-MM-DD 解析本地日期，无效值返回 null */
function parseDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(date.getTime())) return null
  return date
}

/** 自定义日期按本地自然日计算：开始日 00:00:00，结束日 23:59:59.999；留空表示不限制该侧 */
export function matchesDate(createdAt: number, range: DateRange, start: string, end: string): boolean {
  if (range === 'all') return true
  if (range !== 'custom') return createdAt >= Date.now() - Number(range) * 86_400_000
  const from = parseDay(start)
  const to = parseDay(end)
  if (from && createdAt < from.getTime()) return false
  if (to && createdAt > to.getTime() + 86_400_000 - 1) return false
  return true
}
