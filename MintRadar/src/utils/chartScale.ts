// Latency axis: starts at 0, with ticks on round values and a step that always differs between ticks.
// - The old formatter rounded every tick to the nearest 100 ms, so a 160-240 ms range read "300ms, 200ms, 200ms, 200ms".
// - The axis then followed the data (a 275-375 ms axis for a week between 290 and 350 ms), which drew a 30 ms change
//   as a cliff. Latency is a ratio scale, so the axis starts at 0 and a small change looks small.
const TICK_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
export function latencyScale(values: Array<number | null>): { domain: [number, number]; ticks: number[] } {
  const v = values.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
  if (v.length === 0) return { domain: [0, 100], ticks: [0, 50, 100] }
  const max = Math.max(...v, 1)
  // Four steps or fewer up to a little above the highest value.
  const step = TICK_STEPS.find(t => t * 4 >= max * 1.05) ?? 10_000
  const hi = Math.max(step, Math.ceil((max * 1.05) / step) * step)
  const ticks: number[] = []
  for (let t = 0; t <= hi; t += step) ticks.push(t)
  return { domain: [0, hi], ticks }
}
