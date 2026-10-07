// Latency axis: ticks on round values with a step that always differs between ticks. The old formatter
// rounded every tick to the nearest 100 ms, so a 160-240 ms range read "300ms, 200ms, 200ms, 200ms".
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
export function latencyScale(values: Array<number | null>): { domain: [number, number]; ticks: number[] } {
  const v = values.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  if (v.length === 0) return { domain: [0, 100], ticks: [0, 50, 100] }
  const min = Math.min(...v), max = Math.max(...v)
  const span = Math.max(max - min, max * 0.1, 10)
  const step = TICK_STEPS.find(t => t >= (span * 1.2) / 3) ?? 10_000
  const lo = Math.max(0, Math.floor((min * 0.95) / step) * step)
  let hi = Math.ceil((max * 1.05) / step) * step
  if (hi <= lo) hi = lo + step
  const ticks: number[] = []
  for (let t = lo; t <= hi; t += step) ticks.push(t)
  return { domain: [lo, hi], ticks }
}
