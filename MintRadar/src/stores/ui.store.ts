import { create } from 'zustand'

type ViewMode = 'compact' | 'expanded'

interface UIState {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

function getInitialViewMode(): ViewMode {
  if (typeof window !== 'undefined' && window.innerWidth < 768) return 'compact'
  try {
    const stored = localStorage.getItem('mintradar-card-view')
    if (stored === 'expanded') return 'expanded'
  } catch { /* intentional */ }
  return 'compact'
}

export const useUIStore = create<UIState>(set => ({
  viewMode: getInitialViewMode(),
  setViewMode: (mode) => {
    try { localStorage.setItem('mintradar-card-view', mode) } catch { /* intentional */ }
    set({ viewMode: mode })
  },
}))
