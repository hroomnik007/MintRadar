// Stage-1 UI quick wins (2026-10-25): the pure helpers and small components behind the phone "Show all N" cut,
// archived Stats movers, the copy-button accessible name, the Compare audit label and the /mint/nostr error page.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

vi.mock('@/core/nostr/pool', () => ({
  sharedPool: { querySync: () => new Promise<never>(() => undefined), subscribeMany: () => ({ close: () => undefined }) },
}))

import { collapseOnline, showingNoteText, mobileCollapseApplies, showLessApplies, MOBILE_COLLAPSED_ONLINE, MOBILE_COLLAPSE_QUERY } from '@/utils/mobileCollapse'
import { archivedUrlSet, withoutArchivedMovers } from '@/utils/reliabilityMovers'
import { CopyTextButton } from '@/components/mint/CopyTextButton'
import { COMPARE_AUDIT_LABEL } from '@/utils/compareLabels'
import { LOW_RELIABILITY_TEXT, reliabilityScoreInfo } from '@/utils/mintFormatting'
import MintNaddr, { NADDR_INVALID_TEXT } from '@/pages/MintNaddr'

const m = (url: string, online: boolean) => ({ url, online })

describe('"Showing X of Y" note (showingNoteText)', () => {
  const on = (n: number) => Array.from({ length: n }, () => ({ online: true }))
  it('uncollapsed: unchanged desktop copy over the tracked total', () => {
    const shown = [...on(50), { online: false }]
    expect(showingNoteText(shown, 62, { collapsed: false, onlineTotal: 50 })).toBe('Showing 51 of 62')
  })
  it('collapsed (phone): counts online mints so it matches "Show all N"', () => {
    expect(showingNoteText(on(10), 62, { collapsed: true, onlineTotal: 50 })).toBe('Showing 10 of 50 online')
  })
  it('collapsed with revealed offline rows: names them separately', () => {
    const shown = [...on(10), { online: false }, { online: null }]
    expect(showingNoteText(shown, 62, { collapsed: true, onlineTotal: 50 })).toBe('Showing 10 of 50 online · 2 offline')
  })
})

describe('phone dashboard cut (collapseOnline)', () => {
  const online = Array.from({ length: 14 }, (_, i) => m(`on${i}`, true))
  it('keeps the first 10 online mints in the given order and reports the online total', () => {
    const r = collapseOnline(online, MOBILE_COLLAPSED_ONLINE)
    expect(r.collapsed).toBe(true)
    expect(r.onlineTotal).toBe(14)
    expect(r.shown.map(x => x.url)).toEqual(online.slice(0, 10).map(x => x.url))
  })
  it('never cuts offline mints revealed by the hidden-mints toggle, and keeps their place', () => {
    const list = [m('on0', true), m('off-a', false), ...online.slice(1), m('off-b', false)]
    const r = collapseOnline(list, 10)
    expect(r.shown.filter(x => !x.online).map(x => x.url)).toEqual(['off-a', 'off-b'])
    expect(r.shown.filter(x => x.online)).toHaveLength(10)
    expect(r.shown[1]?.url).toBe('off-a')
  })
  it('does nothing at or under the limit, or with no limit', () => {
    expect(collapseOnline(online.slice(0, 10), 10).collapsed).toBe(false)
    expect(collapseOnline(online, null).shown).toHaveLength(14)
  })
  it('applies only to the phone default view', () => {
    const base = { isPhone: true, expanded: false, search: '', activeFilterCount: 0, status: 'online' }
    expect(mobileCollapseApplies(base)).toBe(true)
    expect(mobileCollapseApplies({ ...base, isPhone: false })).toBe(false)
    expect(mobileCollapseApplies({ ...base, expanded: true })).toBe(false)
    expect(mobileCollapseApplies({ ...base, search: ' x ' })).toBe(false)
    expect(mobileCollapseApplies({ ...base, search: '   ' })).toBe(true)
    expect(mobileCollapseApplies({ ...base, activeFilterCount: 1 })).toBe(false)
    expect(mobileCollapseApplies({ ...base, status: 'all' })).toBe(false)
    expect(MOBILE_COLLAPSE_QUERY).toBe('(max-width: 640px)')
  })
  it('offers "Show less" only on an expanded phone default view', () => {
    const expanded = { isPhone: true, expanded: true, search: '', activeFilterCount: 0, status: 'online' }
    expect(showLessApplies(expanded)).toBe(true)
    expect(showLessApplies({ ...expanded, expanded: false })).toBe(false)
    // Desktop / tablet unchanged: never a button, even with the session flag left over from a phone-width window.
    expect(showLessApplies({ ...expanded, isPhone: false })).toBe(false)
    // A search or filter already shows every result, so there is nothing to collapse back to.
    expect(showLessApplies({ ...expanded, search: 'x' })).toBe(false)
    expect(showLessApplies({ ...expanded, activeFilterCount: 2 })).toBe(false)
    expect(showLessApplies({ ...expanded, status: 'all' })).toBe(false)
  })
})

describe('Stats movers without archived mints', () => {
  const data = { risers: [{ url: 'a', name: 'A', delta: 5 }, { url: 'z', name: 'Z', delta: 3 }], fallers: [{ url: 'z', name: 'Z', delta: -4 }] }
  it('drops archived urls from both lists', () => {
    const archived = archivedUrlSet([{ url: 'a' }, { url: 'z', archived: true }])
    expect(withoutArchivedMovers(data, archived)).toEqual({ risers: [data.risers[0]], fallers: [] })
  })
  it('leaves the rows unchanged until the known-mints list has loaded', () => {
    expect(archivedUrlSet(undefined)).toBeNull()
    expect(withoutArchivedMovers(data, null)).toBe(data)
  })
})

describe('CopyTextButton accessible name', () => {
  it('starts with the visible label (WCAG 2.5.3)', () => {
    render(<CopyTextButton label="Copy URL" what="mint URL" value="https://x" />)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-label')).toBe('Copy URL: mint URL')
    expect(btn.getAttribute('aria-label')!.startsWith(btn.textContent!.trim())).toBe(true)
  })
})

describe('Compare audit label and low-reliability badge text', () => {
  it('names what the ratio counts and stays short enough for the 160 px label column', () => {
    expect(COMPARE_AUDIT_LABEL).toBe('No mint fault (7d)')
    expect(COMPARE_AUDIT_LABEL.length).toBeLessThanOrEqual(18)
  })
  it('the "Low" reliability badge uses the lifted text colour', () => {
    expect(reliabilityScoreInfo(10).color).toBe(LOW_RELIABILITY_TEXT)
  })
})

function Home() { const loc = useLocation(); return <p>home {(loc.state as { openAddMint?: boolean } | null)?.openAddMint ? 'add-mint' : ''}</p> }

describe('/mint/nostr/:naddr with a bad link', () => {
  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/mint/nostr/:naddr" element={<MintNaddr />} />
        </Routes>
      </MemoryRouter>,
    )
  }
  it('shows a short error instead of redirecting home', async () => {
    renderAt('/mint/nostr/not-an-naddr')
    expect(await screen.findByRole('heading', { level: 1, name: 'Mint link not found' })).toBeTruthy()
    expect(screen.getByText(NADDR_INVALID_TEXT)).toBeTruthy()
    expect(screen.queryByText(/^home/)).toBeNull()
  })
  it('"Add a mint" opens the Dashboard with the add-mint form requested', async () => {
    renderAt('/mint/nostr/not-an-naddr')
    fireEvent.click(await screen.findByRole('button', { name: 'Add a mint' }))
    expect(screen.getByText('home add-mint')).toBeTruthy()
  })
})
