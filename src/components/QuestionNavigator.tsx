import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './ui'

export interface QuestionNavItem {
  id: string
  label: string
}

/**
 * 详情页翻页导航：上一题 / 下一题、第 X 题共 N 题、下拉跳题。
 * - compact：放在页头下方的紧凑条
 * - 完整模式放在页脚，含跳题下拉
 * - 支持 ← → 键快速切换（输入框聚焦或弹窗打开时自动禁用）
 */
export function QuestionNavigator({
  items,
  currentId,
  basePath,
  compact = false,
  enabled = true,
  footer = false,
  scopeLabel,
}: {
  items: QuestionNavItem[]
  currentId: string
  basePath: string
  compact?: boolean
  enabled?: boolean
  footer?: boolean
  scopeLabel?: string
}) {
  const navigate = useNavigate()
  const index = items.findIndex((item) => item.id === currentId)
  const total = items.length
  const current = index + 1
  const hasPrev = index > 0
  const hasNext = index >= 0 && index < total - 1

  const go = (target: number) => {
    if (target < 0 || target >= total) return
    navigate(`${basePath}/${items[target].id}`)
  }

  useEffect(() => {
    if (!enabled || total < 2 || index < 0) return
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const target = event.target as HTMLElement | null
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return
      event.preventDefault()
      go(index + (event.key === 'ArrowRight' ? 1 : -1))
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // go 依赖 items/basePath，这些值变化时重新绑定即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, index, total, items, basePath])

  if (total === 0 || index < 0) return null

  return (
    <div className={`question-nav${compact ? ' compact' : ''}${footer ? ' question-nav-footer' : ''}`}>
      <button className="btn btn-sm" disabled={!hasPrev} onClick={() => go(index - 1)}>
        <Icon name="back" size={14} /> 上一题
      </button>
      {scopeLabel && <span className="chip chip-primary question-nav-scope">{scopeLabel}</span>}
      <span className="question-nav-count">
        {compact ? `第 ${current} / ${total} 题` : `第 ${current} 题，共 ${total} 题`}
      </span>
      {!compact && (
        <select
          className="select question-nav-jump"
          value={index}
          onChange={(event) => go(Number(event.target.value))}
          aria-label="跳转到指定题"
        >
          {items.map((item, i) => (
            <option key={item.id} value={i}>
              第 {i + 1} 题 · {item.label}
            </option>
          ))}
        </select>
      )}
      <button className="btn btn-sm" disabled={!hasNext} onClick={() => go(index + 1)}>
        下一题 <Icon name="chevron" size={14} />
      </button>
      {!compact && <span className="question-nav-hint">← → 键切换</span>}
    </div>
  )
}
