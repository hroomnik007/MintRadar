import { createContext, useContext, type ReactNode } from 'react'
import { usePinLock } from '../hooks/usePinLock'

type PinLockContextValue = ReturnType<typeof usePinLock>

const PinLockContext = createContext<PinLockContextValue | null>(null)

export function PinLockProvider({ children }: { children: ReactNode }) {
  const pinLock = usePinLock()
  return <PinLockContext.Provider value={pinLock}>{children}</PinLockContext.Provider>
}

export function usePinLockContext(): PinLockContextValue {
  const ctx = useContext(PinLockContext)
  if (!ctx) throw new Error('usePinLockContext must be used inside PinLockProvider')
  return ctx
}
