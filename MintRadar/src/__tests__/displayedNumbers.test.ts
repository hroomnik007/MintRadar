// Numbers shown outside tooltips come from the constants the code computes with (tooltipTexts.ts, networkHealthIndex.ts,
// mintFormatting.ts). Each text equals what it said when the number was typed into it, and follows its constant.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import * as T from '@/utils/tooltipTexts'
import { DEGRADED_AFTER_HOURS, NHI_WEIGHTS, nhiFormulaText, nhiSubtitle, nhiBaseSubtitle } from '@/utils/networkHealthIndex'
import { FRESH_MINT_MONTHS, mintAgeBadge } from '@/utils/mintFormatting'
import { AUDIT_MIN_SAMPLES } from '@/utils/auditScore'
import { UPDOWN_COOLDOWN_MINUTES as beUpdown, DM_DAILY_CAP as beCap } from '../../backend/src/notificationLimits'

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')

describe('the constants equal the backend values they repeat', () => {
  it('notification limits', () => {
    expect(T.UPDOWN_COOLDOWN_MINUTES).toBe(beUpdown)
    expect(T.DM_DAILY_CAP).toBe(beCap)
  })
  it('retention, subscription cap and outages default are the backend source lines', () => {
    expect(read('../../backend/src/db.ts')).toContain(`interval '${T.NOTIFICATION_RETENTION_DAYS} days'`)
    expect(read('../../backend/src/index.ts')).toContain(`const MAX_SUBSCRIPTIONS_PER_PUBKEY = ${T.MAX_NOTIFICATION_SUBSCRIPTIONS}`)
    expect(read('../../backend/src/index.ts')).toMatch(new RegExp(`parseInt\\(daysParam, 10\\)\\)\\)\\s*:\\s*${T.OUTAGES_WINDOW_DAYS}\\b`))
  })
})

describe('texts equal the literals they replaced (current values)', () => {
  it('breakdown row labels', () => {
    expect([T.UPTIME_ROW_LABEL, T.AUDIT_ROW_LABEL, T.NUT_ROW_LABEL, T.VERSION_ROW_LABEL, T.CONTACT_ROW_LABEL])
      .toEqual(['Uptime (40%)', 'Audit reliability (25%)', 'NUT Support (15%)', 'Version (15%)', 'Contact (5%)'])
  })
  it('audit detail lines', () => {
    expect(T.auditTooFewDetail()).toBe('Not enough audit data yet (fewer than 10 swaps in the last 7 days): neutral')
    expect(T.auditTooOldDetail()).toBe('Audit data older than 7 days: neutral')
    expect(AUDIT_MIN_SAMPLES).toBe(10)
  })
  it('outages', () => {
    expect(T.outagesCountLabel()).toBe('Outages (30d)')
    expect(T.noOutagesText()).toBe('No outages in the last 30 days.')
  })
  it('watchlist explainer and notices', () => {
    expect(T.watchlistNotifyExplainer()).toBe("Optional Nostr DMs: one when a watched mint goes down, one when it's back (max once an hour each, 40 a day in total). With any alert on, you also get key and fee changes. Needs a Nostr client with private messages.")
    expect(T.notifyStopNotice('Alpha')).toBe("Couldn't turn off notifications for Alpha. They stop within 30 days.")
    expect(T.notifyLimitText()).toBe('Notification limit reached (50 mints).')
  })
  it('hidden mints note and the Network Health Index texts', () => {
    expect(T.hiddenMintsText(3, DEGRADED_AFTER_HOURS)).toBe('3 mints hidden (offline 24h+)')
    expect(nhiBaseSubtitle()).toBe('Weighted from five factors.')
    expect(nhiFormulaText()).toContain('Tracking history (share of mints tracked 1 month+) stands in for churn rate')
  })
})

describe('each text follows its constant', () => {
  it('row labels', () => { expect(T.scoreRowLabel('Uptime', 45)).toBe('Uptime (45%)') })
  it('audit lines', () => {
    expect(T.auditTooFewDetail(20, 14)).toBe('Not enough audit data yet (fewer than 20 swaps in the last 14 days): neutral')
    expect(T.auditTooOldDetail(14)).toBe('Audit data older than 14 days: neutral')
  })
  it('outages', () => {
    expect(T.outagesCountLabel(90)).toBe('Outages (90d)')
    expect(T.noOutagesText(90)).toBe('No outages in the last 90 days.')
  })
  it('explainer: cooldown unit and daily cap', () => {
    expect(T.cooldownUnit(60)).toBe('hour')
    expect(T.cooldownUnit(120)).toBe('2 hours')
    expect(T.cooldownUnit(45)).toBe('45 minutes')
    expect(T.watchlistNotifyExplainer(120, 25)).toContain('max once per 2 hours each')
    expect(T.watchlistNotifyExplainer(120, 25)).toContain('25 a day in total')
  })
  it('notices', () => {
    expect(T.notifyStopNotice('Alpha', 7)).toContain('within 7 days.')
    expect(T.notifyLimitText(10)).toBe('Notification limit reached (10 mints).')
  })
  it('hidden mints note', () => { expect(T.hiddenMintsText(2, 48)).toBe('2 mints hidden (offline 48h+)') })
  it('NHI subtitle counts the weights, the formula names the Fresh threshold', () => {
    const six = { ...NHI_WEIGHTS, extra: 0 } as unknown as typeof NHI_WEIGHTS
    expect(nhiBaseSubtitle(six)).toBe('Weighted from six factors.')
    expect(nhiSubtitle(six)).toBe('Weighted from six factors.')
    expect(nhiFormulaText(NHI_WEIGHTS, 2)).toContain('mints tracked 2 months+)')
  })
  it('"Fresh" ends at FRESH_MINT_MONTHS', () => {
    const at = (months: number) => new Date(Date.now() - months * 30.44 * 86_400_000).toISOString()
    expect(FRESH_MINT_MONTHS).toBe(1)
    expect(mintAgeBadge(at(FRESH_MINT_MONTHS - 0.1))?.label).toBe('Fresh')
    expect(mintAgeBadge(at(FRESH_MINT_MONTHS + 0.1))?.label).not.toBe('Fresh')
  })
})

describe('the components use the generated texts, not typed numbers', () => {
  const md = read('../pages/MintDetail.tsx')
  it('Mint Detail', () => {
    for (const lit of ["'Uptime (40%)'", "'Audit reliability (25%)'", "'NUT Support (15%)'", "'Version (15%)'", "'Contact (5%)'", 'last 7 days', 'last 30 days', 'Outages (30d)', '&days=30']) {
      expect(md, lit).not.toContain(lit)
    }
    for (const call of ['UPTIME_ROW_LABEL', 'auditTooFewDetail()', 'auditTooOldDetail()', 'outagesCountLabel()', 'noOutagesText()', '&days=${OUTAGES_WINDOW_DAYS}', 'max: UPTIME_POINTS', 'max: CONTACT_POINTS']) {
      expect(md, call).toContain(call)
    }
  })
  it('Watchlist, notices, Dashboard', () => {
    expect(read('../pages/Watchlist.tsx')).toContain('{watchlistNotifyExplainer()}')
    expect(read('../pages/Watchlist.tsx')).not.toContain('at most 40 a day')
    expect(read('../core/nostr/removeWatchedMint.ts')).toContain('notifyStopNotice(name)')
    expect(read('../components/mint/NotifyStrip.tsx')).toContain('notifyLimitText()')
    expect(read('../pages/Dashboard.tsx')).toContain('hiddenMintsText(hiddenCount, DEGRADED_AFTER_HOURS)')
    expect(read('../pages/Dashboard.tsx')).not.toContain('mints hidden (offline')
  })
})
