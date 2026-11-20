// Mint Detail "History" tab: period / metric switches, summary figures, the lazy recharts line chart and one timeline of
// outages and software changes (2026-11-19 redesign, phase 4c). The period and metric state, the queries and all derived figures stay in MintDetail (so the chosen period
// survives tab switches as before) and are passed in; this component holds no state.
import { lazy, Suspense } from 'react'
import { useMediaQuery } from '@/hooks/useIsMobile'
import { InfoTooltip } from '@/components/InfoTooltip'
import { formatDate } from '@/utils/formatDate'
import { reliabilityScoreInfo } from '@/utils/mintFormatting'
import type { OutagesResponse } from '@/utils/mintDetailFacts'
import { noOutagesText, outagesCountLabel, OUTAGES_WINDOW_DAYS } from '@/utils/tooltipTexts'
import { buildHistoryEvents, compareSentence, outageFigureNote, outageHeadline, PERIOD_WORDS, versionText } from '@/utils/historyTimeline'
import { PROBE_LOCATION } from '@/constants/probeLocation'
import type { HistoryChartPoint } from '../MintDetailHistoryChart'

// The chart (recharts, ~350 kB) loads on demand, only when the History tab is opened.
const MintDetailHistoryChart = lazy(() => import('../MintDetailHistoryChart'))
// Chart height (220 since the chart has the full width, 2026-11-19 redesign); the Suspense placeholder uses the same value so the History tab does not jump when the chunk arrives.
const HISTORY_CHART_HEIGHT = 220

/** "13:30": the start time of an outage in the viewer's local time zone (the date is in the row's date column). */
function formatOutageStart(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
}

export type ChartInterval = '24h' | '7d' | '30d' | '90d'

/** The period switch in words (2026-11-19 mockup alignment; it read "24h", "7d"…). */
const PERIOD_LABELS: Record<ChartInterval, string> = { '24h': '24 h', '7d': '7 days', '30d': '30 days', '90d': '90 days' }

/** "Lowest 97, highest 98" (or "98 the whole period") from the chart's score points; null without any. */
function scoreRangeSentence(points: ReadonlyArray<{ reliability: number | null }>): string | null {
  const v = points.map(p => p.reliability).filter((x): x is number => typeof x === 'number')
  if (v.length === 0) return null
  const lo = Math.round(Math.min(...v)), hi = Math.round(Math.max(...v))
  return lo === hi ? `${hi} the whole period` : `Lowest ${lo}, highest ${hi}`
}
export type ChartMetric = 'latency' | 'uptime' | 'reliability'

export interface HistoryTabProps {
  chartInterval: ChartInterval
  onChartInterval: (iv: ChartInterval) => void
  chartMetric: ChartMetric
  onChartMetric: (m: ChartMetric) => void
  chartAvgLatency: number | null
  chartPrevLatency: number | null
  chartAvgUptime: number | null
  chartPrevUptime: number | null
  chartPrevInsufficientHistory: boolean
  chartAvgReliability: number | null
  chartLatencyPercentiles: string | null
  chartCoverage: string | null
  histLineData: HistoryChartPoint[]
  outagesData: OutagesResponse | undefined
  lastErrorText: string | null
  versionHistory: Array<{ version: string; firstSeenAt: string }> | undefined
}

export function HistoryTab({
  chartInterval, onChartInterval, chartMetric, onChartMetric,
  chartAvgLatency, chartPrevLatency, chartAvgUptime, chartPrevUptime, chartPrevInsufficientHistory, chartAvgReliability,
  chartLatencyPercentiles, chartCoverage, histLineData, outagesData, lastErrorText, versionHistory,
}: HistoryTabProps) {
  // 2026-11-19 redesign (phase 4c): the period switch heads the whole tab, four figures in one frame with a sentence
  // against the period before, the chart at full width, and ONE timeline of outages and software changes.
  const narrow = useMediaQuery('(max-width: 640px)')
  const period = PERIOD_WORDS[chartInterval]
  const events = buildHistoryEvents(outagesData?.outages, versionHistory, lastErrorText)
  const count = outagesData?.outageCount ?? null
  const ongoing = outagesData?.ongoing === true
  const outageSub = outageFigureNote(outagesData)
  const metricLabel = chartMetric === 'latency' ? 'Latency' : chartMetric === 'uptime' ? 'Uptime' : 'Reliability Score'
  return (<>
    <div className="md-hist-bar">
      <p className="md-hist-intro">The figures and the chart cover the period you pick. Outages and software changes are listed below.</p>
      <div className="md-seg" role="group" aria-label="Period">
        {(['24h', '7d', '30d', '90d'] as const).map(iv => (
          <button
            key={iv}
            type="button"
            onClick={() => onChartInterval(iv)}
            className={chartInterval === iv ? 'on' : ''}
            aria-pressed={chartInterval === iv}
          >{PERIOD_LABELS[iv]}</button>
        ))}
      </div>
    </div>

    <div className="md-hist-summary md-hist-figs">
      <div className="md-hist-fig">
        <div className="md-hist-fig-value">
          {chartAvgLatency !== null ? <>{chartAvgLatency}<span className="md-strip-unit"> ms</span></> : '—'}
          {chartAvgLatency !== null && chartLatencyPercentiles && <span className="md-hist-fig-tip" data-testid="hist-latency-percentiles"><InfoTooltip iconSize={12} width={240} about="Average latency" text={chartLatencyPercentiles} /></span>}
        </div>
        <div className="md-hist-fig-label">Average latency</div>
        {(() => { const d = compareSentence('latency', chartAvgLatency, chartPrevLatency, chartInterval, chartPrevInsufficientHistory); return d && <div className="md-hist-fig-delta">{d}</div> })()}
      </div>
      <div className="md-hist-fig">
        <div className="md-hist-fig-value" style={{ color: chartAvgUptime !== null ? 'var(--accent)' : undefined }}>
          {chartAvgUptime !== null ? <>{chartAvgUptime}<span className="md-strip-unit">%</span></> : '—'}
        </div>
        <div className="md-hist-fig-label">Average uptime</div>
        {(() => { const d = compareSentence('uptime', chartAvgUptime, chartPrevUptime, chartInterval, chartPrevInsufficientHistory); return d && <div className="md-hist-fig-delta">{d}</div> })()}
      </div>
      <div className="md-hist-fig">
        <div className="md-hist-fig-value" style={{ color: chartAvgReliability !== null ? reliabilityScoreInfo(chartAvgReliability).color : 'var(--text3)' }}>
          {chartAvgReliability !== null ? String(chartAvgReliability) : '—'}
        </div>
        <div className="md-hist-fig-label">Average Reliability Score</div>
        {chartAvgReliability !== null && <div className="md-hist-fig-delta">{scoreRangeSentence(histLineData) ?? reliabilityScoreInfo(chartAvgReliability).label}</div>}
      </div>
      <div className="md-hist-fig" data-testid="outage-tile-count">
        <div className="md-hist-fig-value" style={ongoing ? { color: 'var(--red)' } : undefined}>{count !== null ? String(count) : '—'}</div>
        <div className="md-hist-fig-label">{outagesCountLabel(count)}</div>
        {outageSub && <div className="md-hist-fig-delta">{outageSub}</div>}
      </div>
    </div>

    <section className="md-panel md-hist-chart" aria-labelledby="md-hist-chart-title">
      <div className="md-panel-h">
        <div>
          <h2 id="md-hist-chart-title" className="md-panel-title">{metricLabel}, {period}</h2>
          {chartMetric === 'latency' && <p className="md-panel-sub">From {PROBE_LOCATION}.</p>}
        </div>
        <div className="md-seg md-hist-metric" role="group" aria-label="Metric">
          {([['latency', 'Latency'], ['uptime', 'Uptime'], ['reliability', 'Score']] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => onChartMetric(m)}
              className={chartMetric === m ? 'on' : ''}
              aria-pressed={chartMetric === m}
            >{label}</button>
          ))}
        </div>
      </div>
      {histLineData.length === 0 ? (
        <p className="md-hist-empty">No historical data for this period.</p>
      ) : chartMetric === 'latency' && histLineData.filter(d => d.latency !== null).length === 0 ? (
        <p className="md-hist-empty">No latency samples, the mint was offline this period.</p>
      ) : histLineData.filter(d => d[chartMetric] !== null).length === 0 ? (
        <p className="md-hist-empty">Not enough data for this period.</p>
      ) : (
        <Suspense fallback={<div style={{ height: HISTORY_CHART_HEIGHT }} />}>
          <MintDetailHistoryChart data={histLineData} metric={chartMetric} interval={chartInterval} height={HISTORY_CHART_HEIGHT} narrow={narrow} />
        </Suspense>
      )}
      {chartCoverage && <div className="md-hist-coverage">{chartCoverage}</div>}
    </section>

    <section className="md-panel md-hist-events" aria-labelledby="md-hist-events-title">
      <div className="md-panel-h">
        <div>
          <h2 id="md-hist-events-title" className="md-panel-title">What happened</h2>
          <p className="md-panel-sub">Outages in the last {OUTAGES_WINDOW_DAYS} days and software changes, newest first.</p>
        </div>
      </div>
      {count === 0 && <p className="md-hist-none">{noOutagesText()}</p>}
      {events.length === 0 ? (
        <p className="md-hist-empty">No version history available.</p>
      ) : (
        <ol className="md-events">
          {events.map((ev, i) => (
            <li key={i} className={`md-ev md-ev-${ev.kind}`} {...(ev.kind === 'outage' && ev.ongoing ? { 'data-ongoing': 'true' } : {})}>
              <span className="md-ev-date">{formatDate(ev.at, { year: false, local: true })}</span>
              <span className="md-ev-mark" aria-hidden="true" />
              <span className="md-ev-text">
                {ev.kind === 'outage' ? (
                  <>
                    <b>{outageHeadline(ev)}</b>
                    <span className="md-ev-why">
                      {ev.truncated ? `Started before the ${OUTAGES_WINDOW_DAYS}-day window` : `From ${formatOutageStart(ev.at)}`}
                      {ev.error ? `. ${ev.error}` : ''}
                    </span>
                  </>
                ) : ev.from === null ? (
                  <><b>First seen</b> running <span className="md-ev-code">{versionText(ev.to)}</span></>
                ) : ev.switched ? (
                  <><b>Switched software</b> from <span className="md-ev-code">{versionText(ev.from)}</span> to <span className="md-ev-code">{versionText(ev.to)}</span></>
                ) : (
                  <><b>Updated</b> <span className="md-ev-code">{versionText(ev.from)}</span> to <span className="md-ev-code">{ev.to.split('/').pop()}</span></>
                )}
              </span>
              <span className="md-ev-kind">{ev.kind === 'outage' ? 'Outage' : 'Software'}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  </>)
}
