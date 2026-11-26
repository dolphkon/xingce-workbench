export type ThemeKey = 'light' | 'dark'

export const THEME_KEY = 'xingce-theme'
export const THEME_CHANGE_EVENT = 'xingce-theme-change'

export function readTheme(): ThemeKey {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function apply(theme: ThemeKey, persist: boolean): void {
  document.documentElement.dataset.theme = theme
  if (persist) {
    try { window.localStorage.setItem(THEME_KEY, theme) } catch { /* 忽略写失败 */ }
  }
  window.dispatchEvent(new CustomEvent<ThemeKey>(THEME_CHANGE_EVENT, { detail: theme }))
}

/** 首帧同步应用，避免主题先亮后暗闪烁 */
export function initTheme(): ThemeKey {
  const theme = readTheme()
  apply(theme, false)
  return theme
}

export function setTheme(theme: ThemeKey): void {
  apply(theme, true)
}
