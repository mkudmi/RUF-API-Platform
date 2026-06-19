import {
  SQL_TERMINAL_MIN_HEIGHT_PX,
  SQL_TERMINAL_MIN_WIDTH_PX,
  WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX,
} from '../constants'

export function getWindowTitlebarHeightPx() {
  if (typeof document === 'undefined') return WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
  const el = document.querySelector<HTMLElement>('.windowTitlebar')
  const measured = el?.getBoundingClientRect().height ?? WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
  return Math.max(0, Math.round(measured)) || WINDOW_TITLEBAR_FALLBACK_HEIGHT_PX
}

export function getSqlTerminalMaxHeightPx() {
  if (typeof window === 'undefined') return 420
  const topReserved = getWindowTitlebarHeightPx()
  return Math.max(SQL_TERMINAL_MIN_HEIGHT_PX, Math.floor(window.innerHeight - topReserved))
}

export function getSqlTerminalMaxWidthPx() {
  if (typeof window === 'undefined') return 980
  return Math.max(SQL_TERMINAL_MIN_WIDTH_PX, Math.floor(window.innerWidth - 280))
}

export function getSqlTerminalBaseWidthPx() {
  if (typeof window === 'undefined') return 680
  const max = getSqlTerminalMaxWidthPx()
  return Math.max(SQL_TERMINAL_MIN_WIDTH_PX, Math.round(Math.min(window.innerWidth * 0.68, max)))
}

export function getSqlTerminalBaseHeightPx() {
  if (typeof window === 'undefined') return 420
  const max = getSqlTerminalMaxHeightPx()
  return Math.round(Math.min(window.innerHeight * 0.38, max))
}
