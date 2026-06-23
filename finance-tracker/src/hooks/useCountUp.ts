import { useState, useEffect, useRef } from 'react'

export function useCountUp(target: number, duration = 900): number {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)
  const startRef = useRef(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    fromRef.current = value
    startRef.current = performance.now()
    cancelAnimationFrame(rafRef.current)

    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(fromRef.current + (target - fromRef.current) * eased)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])

  return value
}
