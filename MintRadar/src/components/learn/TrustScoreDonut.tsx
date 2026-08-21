import './LearnDiagrams.css'

// Module 3 — the Trust Score weights as a donut. Drawn with the same
// stroke-dasharray-on-a-circle technique as the Network Health gauge on the
// Stats page, and weighted/ordered to match the Trust Score Breakdown modal
// in MintDetail.tsx so the reader recognises it when they meet it in the app.
//
// The breakdown modal colours each row by how well a given mint scored, which
// has no meaning for a static weight chart. Instead the slices alternate
// green/copper the way the Stats page's bars do — adjacent segments must not
// share a hue family or they read as one arc (the first draft put
// --green-bright and --green side by side and the 45/30 boundary vanished).

interface Segment {
  label: string
  weight: number
  color: string
}

const SEGMENTS: Segment[] = [
  { label: 'Uptime', weight: 45, color: 'var(--green-bright)' },
  { label: 'NUT Support', weight: 30, color: 'var(--copper)' },
  { label: 'Version freshness', weight: 15, color: 'var(--green)' },
  { label: 'Contact info', weight: 5, color: 'var(--amber)' },
  { label: 'Audit reliability', weight: 5, color: 'var(--t3)' },
]

const RADIUS = 44
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
// Hairline gap between slices so adjacent segments stay readable without a
// background-coloured separator stroke.
const GAP = 2.4

export function TrustScoreDonut() {
  // Each slice starts where the preceding weights end. Derived per segment
  // via a prefix sum rather than a running accumulator — the react-hooks
  // immutability rule (compiler-grade, enforced project-wide) forbids
  // reassigning a variable during render.
  const arcs = SEGMENTS.map((seg, i) => {
    const startWeight = SEGMENTS.slice(0, i).reduce((sum, s) => sum + s.weight, 0)
    const length = (seg.weight / 100) * CIRCUMFERENCE
    return {
      ...seg,
      dash: Math.max(length - GAP, 0.5),
      offset: (startWeight / 100) * CIRCUMFERENCE,
    }
  })

  return (
    <div
      className="learn-diagram donut-diagram"
      role="img"
      aria-label="Trust Score weights: uptime 45%, NUT support 30%, version freshness 15%, contact info 5%, audit reliability 5%."
    >
      <div className="donut-chart-wrap">
        <svg viewBox="0 0 120 120" fill="none">
          <circle cx="60" cy="60" r={RADIUS} stroke="var(--bg4)" strokeWidth="13" />
          {arcs.map(arc => (
            <circle
              key={arc.label}
              cx="60"
              cy="60"
              r={RADIUS}
              stroke={arc.color}
              strokeWidth="13"
              strokeDasharray={`${arc.dash.toFixed(2)} ${(CIRCUMFERENCE - arc.dash).toFixed(2)}`}
              strokeDashoffset={(-arc.offset).toFixed(2)}
              transform="rotate(-90 60 60)"
            />
          ))}
          <text x="60" y="58" textAnchor="middle" className="donut-center-num">100</text>
          <text x="60" y="72" textAnchor="middle" className="donut-center-lbl">points</text>
        </svg>
      </div>

      <div className="donut-legend">
        {SEGMENTS.map(seg => (
          <div className="donut-legend-row" key={seg.label}>
            <span className="donut-swatch" style={{ background: seg.color }} />
            <span className="donut-legend-label">{seg.label}</span>
            <span className="donut-legend-weight">{seg.weight}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
