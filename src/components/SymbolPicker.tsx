/**
 * 符号选择器：给文本输入框插入特殊符号（带圈数字 ①②③、括号数字 ⑴、罗马数字 Ⅰ、常用符号等）。
 * 点击符号时阻止 mousedown 默认行为，保持输入框焦点与光标位置，由父组件 onPick 在光标处插入。
 */
import { useEffect, useRef, useState } from 'react'

interface Props {
  onPick: (symbol: string) => void
  title?: string
}

const GROUPS: { label: string; symbols: string[] }[] = [
  { label: '带圈数字', symbols: ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'] },
  { label: '括号数字', symbols: ['⑴', '⑵', '⑶', '⑷', '⑸', '⑹', '⑺', '⑻', '⑼', '⑽', '⒈', '⒉', '⒊', '⒋', '⒌', '⒍', '⒎', '⒏', '⒐', '⒑'] },
  { label: '罗马数字', symbols: ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'ⅰ', 'ⅱ', 'ⅲ', 'ⅳ', 'ⅴ', 'ⅵ', 'ⅶ', 'ⅷ', 'ⅸ', 'ⅹ'] },
  { label: '常用符号', symbols: ['·', '、', '—', '～', '→', '←', '↑', '↓', '↔', '★', '☆', '√', '±', '×', '÷', '°', '％', '‰', '№', '※', '§', '¶', '△', '□', '○', '●', '◆', '◇', '∵', '∴'] },
]

export default function SymbolPicker({ onPick, title = '插入符号（如带圈数字 ①②③）' }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [open])

  return (
    <div className="symbol-picker" ref={wrapRef}>
      <button
        type="button"
        className="rte-tool"
        title={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span style={{ fontWeight: 700 }}>①</span> 符号
      </button>
      {open && (
        <div className="symbol-panel" role="dialog" aria-label="符号面板">
          {GROUPS.map((group) => (
            <div className="symbol-group" key={group.label}>
              <div className="symbol-group-label">{group.label}</div>
              <div className="symbol-grid">
                {group.symbols.map((symbol) => (
                  <button
                    type="button"
                    key={symbol}
                    className="symbol-cell"
                    title={`插入 ${symbol}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { onPick(symbol); setOpen(false) }}
                  >{symbol}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
