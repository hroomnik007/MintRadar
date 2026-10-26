// Mint Detail "History" tab: period / metric switches, summary figures, the lazy recharts line chart, outages and the
// version history. Extracted verbatim from MintDetail.tsx (pure refactor: same DOM, classes, inline styles, aria and
// tooltips). The period and metric state, the queries and all derived figures stay in MintDetail (so the chosen period
// survives tab switches as before) and are passed in; this component holds no state.
import { Fragment, lazy, Suspense, type ReactNode } from 'react'
import { InfoTooltip } from '@/components/InfoTooltip'
import { formatDate } from '@/utils/formatDate'
import { reliabilityScoreInfo } from '@/utils/mintFormatting'
import { outageTiles, outageErrorCell, type OutagesResponse } from '@/utils/mintDetailFacts'
import { outagesCountLabel, noOutagesText, OUTAGES_WINDOW_DAYS } from '@/utils/tooltipTexts'
import type { HistoryChartPoint } from '../MintDetailHistoryChart'

// The chart (recharts, ~350 kB) loads on demand, only when the History tab is opened.
const MintDetailHistoryChart = lazy(() => import('../MintDetailHistoryChart'))
// Chart height; the Suspense placeholder uses the same value so the History tab does not jump when the chunk arrives.
const HISTORY_CHART_HEIGHT = 140

/** "17 Sep 13:30" — day, short month, 24h time, in the viewer's local time zone. */
function formatOutageStart(iso: string): string {
  const d = new Date(iso)
  const date = formatDate(d, { year: false, local: true })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${date} ${time}`
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)} min`
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}
/** A version string with a line-break opportunity after each "/" ("Nutshell/0.20.3"); no <wbr> text is added. */
function versionWithBreaks(v: string): ReactNode {
  const parts = v.split('/')
  return parts.map((part, i) => (i === 0 ? part : <Fragment key={i}>/<wbr />{part}</Fragment>))
}

function deltaStr(curr: number | null, prev: number | null, unit = '', insufficientHistory = false): string | null {
  if (prev === null) return (curr !== null && insufficientHistory) ? 'Not enough history yet' : null
  if (curr === null) return null
  const diff = curr - prev
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(0)}${unit} vs prev period`
}

export type ChartInterval = '24h' | '7d' | '30d' | '90d'
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
  return (<>
            <div className="md-panel">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div className="md-panel-title" style={{ marginBottom: 0 }}>Historical data</div>
              <div className="md-seg" role="group" aria-label="Period">
                {(['24h', '7d', '30d', '90d'] as const).map(iv => (
                  <button
                    key={iv}
                    type="button"
                    onClick={() => onChartInterval(iv)}
                    className={chartInterval === iv ? 'on' : ''}
                  >{iv}</button>
                ))}
              </div>
            </div>

            {/* Summary metric cards */}
            <div className="md-hist-summary">
              {[
                { label: 'Average latency', value: chartAvgLatency !== null ? `${chartAvgLatency} ms` : '—', delta: deltaStr(chartAvgLatency, chartPrevLatency, ' ms', chartPrevInsufficientHistory), tip: chartAvgLatency !== null ? chartLatencyPercentiles : null, color: 'var(--text)' },
                { label: 'Average uptime', value: chartAvgUptime !== null ? `${chartAvgUptime}%` : '—', delta: deltaStr(chartAvgUptime, chartPrevUptime, '%', chartPrevInsufficientHistory), tip: null, color: 'var(--accent)' },
                { label: 'Average reliability', value: chartAvgReliability !== null ? String(chartAvgReliability) : '—', delta: null, tip: null, color: chartAvgReliability !== null ? reliabilityScoreInfo(chartAvgReliability).color : 'var(--text3)' },
              ].map(({ label, value, delta, tip, color }) => (
                <div key={label} className="md-hist-fig">
                  <div className="md-hist-fig-value" style={{ color }}>{value}{tip && <span className="md-hist-fig-tip" data-testid="hist-latency-percentiles"><InfoTooltip iconSize={12} width={240} about={label} text={tip} /></span>}</div>
                  <div className="md-hist-fig-label">{label}</div>
                  {delta && <div className="md-hist-fig-delta">{delta}</div>}
                </div>
              ))}
            </div>

            {/* Tab switcher */}
            <div className="md-seg md-hist-metric" role="group" aria-label="Metric">
              {([['latency', 'Latency'], ['uptime', 'Uptime'], ['reliability', 'Reliability Score']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChartMetric(m)}
                  className={chartMetric === m ? 'on' : ''}
                >{label}</button>
              ))}
            </div>

            {/* Line chart */}
            {histLineData.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>No historical data for this period.</p>
            ) : chartMetric === 'latency' && histLineData.filter(d => d.latency !== null).length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>No latency samples — mint was offline this period.</p>
            ) : histLineData.filter(d => d[chartMetric] !== null).length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text3)', margin: 0 }}>Not enough data for this period</p>
            ) : (
              <Suspense fallback={<div style={{ height: HISTORY_CHART_HEIGHT }} />}>
                <MintDetailHistoryChart data={histLineData} metric={chartMetric} interval={chartInterval} height={HISTORY_CHART_HEIGHT} />
              </Suspense>
            )}
            {chartCoverage && (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{chartCoverage}</div>
            )}
          </div>

          <div className="md-panel">
            <div className="md-panel-title">Outages</div>
            <div className="md-hist-summary" style={{ marginBottom: 12 }}>
              {outageTiles(outagesData, outagesCountLabel(), formatDuration).map(({ key, label, value }) => (
                <div key={key} className="md-hist-fig" data-testid={`outage-tile-${key}`}>
                  <div className="md-hist-fig-value" style={key === 'down' ? { color: 'var(--red)' } : undefined}>{value}</div>
                  <div className="md-hist-fig-label">{label}</div>
                </div>
              ))}
            </div>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>Show outage details</summary>
              {outagesData?.outages && outagesData.outages.length > 0 ? (
                <table className="md-vh-table">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Duration</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {outagesData.outages.slice().reverse().map((o, i) => (
                      <tr key={i} {...(o.ongoing ? { 'data-ongoing': 'true' } : {})}>
                        <td className="md-vh-ver md-vh-to md-vh-wrap">{o.truncatedAtWindowStart ? '≤ ' : ''}{formatOutageStart(o.startedAt)}{o.truncatedAtWindowStart && <InfoTooltip iconSize={11} width={200} about="Outage start" text={`Started before the ${OUTAGES_WINDOW_DAYS}-day window`} />}</td>
                        <td className="md-vh-ver md-vh-to md-vh-wrap">{formatDuration(o.durationMs)}{o.ongoing ? ' (ongoing)' : ''}</td>
                        <td className="md-vh-ver md-vh-to md-vh-wrap">{outageErrorCell(o, lastErrorText)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text3)' }}>{noOutagesText()}</div>
              )}
            </details>
          </div>

          <div className="md-panel">
            <div className="md-panel-title">Version history</div>
            {!versionHistory || versionHistory.length === 0 ? (
              <div style={{fontSize:13,color:'var(--text3)',fontFamily:'var(--font-mono)'}}>No version history available.</div>
            ) : (
              <table className="md-vh-table">
                <colgroup>
                  <col className="md-vh-col-date" />
                  <col className="md-vh-col-from" />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>From</th>
                    <th>To</th>
                  </tr>
                </thead>
                <tbody>
                  {versionHistory.map((vh, i) => (
                    <tr key={i}>
                      <td className="md-vh-date">{formatDate(vh.firstSeenAt)}</td>
                      <td className="md-vh-ver md-vh-from">{versionHistory[i + 1] ? versionWithBreaks(versionHistory[i + 1]!.version) : '—'}</td>
                      <td className="md-vh-ver md-vh-to">{versionWithBreaks(vh.version)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>


          </>)
}
