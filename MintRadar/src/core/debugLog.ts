export interface DebugLogEntry {
  timestamp: number
  message: string
}

const MAX_ENTRIES = 50
const buffer: DebugLogEntry[] = []

export function getDebugLogEntries(): DebugLogEntry[] {
  return buffer
}

function formatArg(a: unknown): string {
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack ?? a.message
  try { return JSON.stringify(a) } catch { return String(a) }
}

// Wraps console.warn so [watchlist-sync] diagnostic logs are also captured into
// an in-memory ring buffer, for the ?debug=1 overlay to display/copy on devices
// without remote debugging access (see DebugLogOverlay.tsx).
export function installConsoleWarnInterceptor(): void {
  const originalWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    originalWarn(...args)
    if (typeof args[0] === 'string' && args[0].startsWith('[watchlist-sync]')) {
      buffer.push({ timestamp: Date.now(), message: args.map(formatArg).join(' ') })
      if (buffer.length > MAX_ENTRIES) buffer.shift()
    }
  }
}
