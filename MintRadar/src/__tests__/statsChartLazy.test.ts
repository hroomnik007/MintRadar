import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8')
const importLines = (src: string) => src.split('\n').filter(l => /^\s*import\b/.test(l) || /^\s*}\s*from\b/.test(l))

// The Stats route chunk must not pull vendor-charts (recharts, ~99 kB gzip) in statically: the header paints from the
// route chunk, the chart library is fetched when the chart is drawn.
describe('Stats loads recharts lazily', () => {
  it('neither Stats.tsx nor ReliabilityTrendChart.tsx imports recharts or the plot module statically', () => {
    for (const rel of ['pages/Stats.tsx', 'components/stats/ReliabilityTrendChart.tsx']) {
      const lines = importLines(read(rel)).join('\n')
      expect(lines, rel).not.toMatch(/recharts/)
      expect(lines, rel).not.toMatch(/ReliabilityTrendPlot/)
    }
  })

  it('the chart card loads the plot module with React.lazy and a dynamic import', () => {
    expect(read('components/stats/ReliabilityTrendChart.tsx')).toMatch(/lazy\(\(\) => import\('\.\/ReliabilityTrendPlot'\)\)/)
  })

  it('only the plot module imports recharts', () => {
    expect(importLines(read('components/stats/ReliabilityTrendPlot.tsx')).join('\n')).toMatch(/from 'recharts'/)
  })
})
