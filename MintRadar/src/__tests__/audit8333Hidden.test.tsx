// Mint Detail Audit tab: audit.8333.space is hidden while its data is missing or stale (auditNeedsFallback, the one
// condition) and everything reappears unchanged when it is fresh.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AuditTab, type AuditTabProps } from '@/pages/mintDetail/AuditTab'
import { auditFreshness, auditNeedsFallback } from '@/utils/auditFreshness'
import { auditNoDataText, cashuInfoViewText } from '@/utils/tooltipTexts'
import type { AuditCzView } from '@/utils/auditCz'

const NOW = Date.parse('2026-10-30T12:00:00Z')
const H = 3_600_000, D = 86_400_000
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('auditNeedsFallback', () => {
  it('fresh 8333 data: shown', () => {
    expect(auditNeedsFallback(true, auditFreshness(ago(3 * H), ago(2 * H), NOW))).toBe(false)
  })
  it('auditor data older than 7 days: hidden', () => {
    expect(auditNeedsFallback(true, auditFreshness(ago(8 * D), ago(2 * H), NOW))).toBe(true)
  })
  it('our sync older than 24 hours: hidden', () => {
    expect(auditNeedsFallback(true, auditFreshness(ago(3 * H), ago(25 * H), NOW))).toBe(true)
  })
  it('no 8333 data at all: hidden', () => {
    expect(auditNeedsFallback(false, auditFreshness(ago(3 * H), ago(2 * H), NOW))).toBe(true)
  })
})

const noop = () => {}
const base: AuditTabProps = {
  auditCzLoading: false, czView: null, show8333Audit: true, czInfoText: null, czSyncNote: null, auditSwitch: null,
  audit8333Stale: null, czData: null, stripMints: 1234, stripMelts: 567, stripReliabilityColor: 'green',
  stripRecentSuccessDisplay: '98 / 100', stripRecentSuccessSub: '98% ok', stripAvgTimeDisplay: '800 ms',
  tipMints: 't', tipMelts: 't', tipSuccess: 't', tipAvg: 't', auditSwapBarItems: [], auditRecentSwapRows: [], auditSwaps: [],
  showAllAuditSwaps: false, setShowAllAuditSwaps: noop, showAllCzFrom: false, showAllCzTo: false, setShowAllCzFrom: noop,
  setShowAllCzTo: noop, auditSwapsLoading: false, auditSwapsError: false, refetchAuditSwaps: () => Promise.resolve(),
}
const cz: AuditCzView = { sourceHref: 'https://cashu.info/mint/x', checkedAt: null, notRecent: false, swaps: [], fromRows: [], toRows: [], tiles: [] }

// Every place the tab could name audit.8333.space: visible text, link targets and tooltip texts (InfoTooltip keeps its
// text in the DOM only when open, so the props are checked through what the tab passes in: czInfoText / the no-data text).
const names8333 = (el: HTMLElement) =>
  /8333/.test(el.textContent ?? '') || [...el.querySelectorAll('a')].some(a => /8333/.test(a.getAttribute('href') ?? ''))

describe('AuditTab with fresh 8333 data (unchanged)', () => {
  it('8333 view: via label, strip and link', () => {
    const { container } = render(<AuditTab {...base} />)
    expect(container.textContent).toContain('via audit.8333.space')
    expect(container.querySelector('.audit-summary-strip')).not.toBeNull()
    expect(container.querySelector('a[href="https://audit.8333.space/"]')).not.toBeNull()
  })
  it('stale-age line still renders when it is passed in the 8333 view', () => {
    const { container } = render(<AuditTab {...base} audit8333Stale="audit.8333.space data is 2 days old" />)
    expect(container.textContent).toContain('audit.8333.space data is 2 days old')
  })
})

describe('AuditTab while 8333 data is stale or missing', () => {
  it('cashu.info covers the mint: only the cashu.info view, nothing names 8333', () => {
    const { container } = render(
      <AuditTab {...base} show8333Audit={false} czView={cz} czData={cz} czInfoText={cashuInfoViewText()} audit8333Stale="audit.8333.space data is 30 days old" />,
    )
    expect(container.textContent).toContain('via cashu.info')
    expect(container.querySelector('.audit-summary-strip:not(.audit-cz-tiles)')).toBeNull()
    expect(container.querySelector('.md-audit-seg')).toBeNull()
    expect(names8333(container)).toBe(false)
    expect(cashuInfoViewText()).not.toMatch(/8333/)
  })
  it('cashu.info has nothing either: "No audit data" panel without the 8333 label', () => {
    const { container } = render(<AuditTab {...base} show8333Audit={false} />)
    expect(container.textContent).toContain('No audit data available for this mint.')
    expect(container.querySelector('.audit-summary-strip')).toBeNull()
    expect(names8333(container)).toBe(false)
    expect(auditNoDataText()).not.toMatch(/8333/)
  })
})
