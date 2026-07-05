import { useSyncExternalStore } from 'react'

// Ticking clock store — lets components read "current time" during render
// without calling the impure Date.now() in render. All subscribers share one
// interval and re-render together every TICK_MS.
const TICK_MS = 30_000

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (timer === null) {
    // Refresh the snapshot when the first subscriber arrives — the module-load
    // value may be arbitrarily stale in a long-lived PWA session.
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      listeners.forEach(l => l())
    }, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function getSnapshot(): number {
  return now
}

/** Current epoch ms, updated every 30 s. Safe to read during render. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot)
}
