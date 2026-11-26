export const FONT_SIZES = [
  { key: 'standard', label: '标准' },
  { key: 'large', label: '大' },
  { key: 'xlarge', label: '超大' },
] as const

export type FontSizeKey = (typeof FONT_SIZES)[number]['key']
export const FONT_SIZE_KEY = 'xingce-font-size'
export const FONT_CHANGE_EVENT = 'xingce-font-change'

export function readFontIndex(): number {
  try {
    const saved = window.localStorage.getItem(FONT_SIZE_KEY)
    const index = FONT_SIZES.findIndex((item) => item.key === saved)
    return index >= 0 ? index : 1
  } catch {
    return 1
  }
}

function apply(index: number, persist: boolean): void {
  const safe = Math.max(0, Math.min(FONT_SIZES.length - 1, index))
  const current = FONT_SIZES[safe]
  document.documentElement.dataset.fontSize = current.key
  if (persist) {
    try { window.localStorage.setItem(FONT_SIZE_KEY, current.key) } catch { /* 忽略写失败 */ }
  }
  window.dispatchEvent(new CustomEvent<number>(FONT_CHANGE_EVENT, { detail: safe }))
}

/** 首帧同步应用，避免字号先小后大闪烁 */
export function initFontSize(): number {
  const index = readFontIndex()
  apply(index, false)
  return index
}

export function setFontIndex(index: number): void {
  apply(index, true)
}

export function cycleFontSize(current: number): number {
  const next = (current + 1) % FONT_SIZES.length
  setFontIndex(next)
  return next
}
