import { test, expect, type Page } from '@playwright/test'
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from 'nostr-tools/pure'
import { installApiMocks, MOCK_MINTS } from './fixtures/mocks'

// A mint with a large review corpus (Minibits-scale: 100+), used to exercise the
// Reviews-tab filter chips (All / 5★ / Critical / Hide anon) and their combinations
// against a realistic dataset rather than a handful of fixture rows.
const MINT_URL = MOCK_MINTS[0]!.url // https://alpha.mint.example
const detailPath = `/mint/${encodeURIComponent(MINT_URL)}`

interface FakeReview {
  rating: number | null
  named: boolean
}

// Segments, each with a known rating + named/anon split. Critical reviews are
// deliberately ALL anonymous, so "Critical + Hide anon" is a real, provable
// zero-match combination (used by the filtered-empty-state test below) rather
// than a hand-counted guess.
const REVIEW_PLAN: FakeReview[] = [
  ...Array.from({ length: 25 }, (): FakeReview => ({ rating: 5, named: true })),
  ...Array.from({ length: 15 }, (): FakeReview => ({ rating: 5, named: false })),
  ...Array.from({ length: 4 }, (): FakeReview => ({ rating: 2, named: false })),
  ...Array.from({ length: 2 }, (): FakeReview => ({ rating: 1, named: false })),
  ...Array.from({ length: 30 }, (): FakeReview => ({ rating: 4, named: true })),
  ...Array.from({ length: 14 }, (): FakeReview => ({ rating: 3, named: true })),
  ...Array.from({ length: 6 }, (): FakeReview => ({ rating: 3, named: false })),
  ...Array.from({ length: 3 }, (): FakeReview => ({ rating: null, named: true })),
  ...Array.from({ length: 6 }, (): FakeReview => ({ rating: null, named: false })),
]

const TOTAL = REVIEW_PLAN.length // 105
const FIVE_STAR_COUNT = REVIEW_PLAN.filter(r => r.rating === 5).length // 40
const CRITICAL_COUNT = REVIEW_PLAN.filter(r => r.rating !== null && r.rating <= 2).length // 6
const NAMED_COUNT = REVIEW_PLAN.filter(r => !!r.named).length // 72
const ANON_COUNT = REVIEW_PLAN.filter(r => !r.named).length // 33
const FIVE_STAR_NAMED_COUNT = REVIEW_PLAN.filter(r => r.rating === 5 && r.named).length // 25
const CRITICAL_NAMED_COUNT = REVIEW_PLAN.filter(r => r.rating !== null && r.rating <= 2 && r.named).length // 0 — by design

interface SignedActor {
  pubkey: string
  reviewEvent: ReturnType<typeof finalizeEvent>
  profileEvent: ReturnType<typeof finalizeEvent> | null
}

function buildSignedActors(): SignedActor[] {
  const now = Math.floor(Date.now() / 1000)
  return REVIEW_PLAN.map((plan, i) => {
    const sk = generateSecretKey()
    const pubkey = getPublicKey(sk)
    const tags: string[][] = [['u', MINT_URL]]
    if (plan.rating !== null) tags.push(['rating', String(plan.rating)])
    const reviewTemplate: EventTemplate = {
      kind: 38000,
      created_at: now - i * 60, // strictly decreasing → deterministic newest-first order
      tags,
      content: plan.rating !== null ? `Review #${i}` : `Endorsement #${i}, no rating`,
    }
    const reviewEvent = finalizeEvent(reviewTemplate, sk)

    let profileEvent: ReturnType<typeof finalizeEvent> | null = null
    if (plan.named) {
      const profileTemplate: EventTemplate = {
        kind: 0,
        created_at: now,
        tags: [],
        content: JSON.stringify({ name: `Reviewer ${i}` }),
      }
      profileEvent = finalizeEvent(profileTemplate, sk)
    }
    return { pubkey, reviewEvent, profileEvent }
  })
}

const ACTORS = buildSignedActors()

// Custom relay stub (replaces the shared mockRelays() for this file): answers the
// live kind:38000 review query and the kind:0 profile query with the signed corpus
// above; everything else (discovery, watchlist sync, etc.) gets an immediate EOSE,
// same as the shared stub in fixtures/mocks.ts.
async function mockReviewRelays(page: Page): Promise<void> {
  await page.routeWebSocket(/^wss:\/\//, ws => {
    ws.onMessage(message => {
      const data = typeof message === 'string' ? message : message.toString()
      let parsed: unknown
      try { parsed = JSON.parse(data) } catch { return }
      if (!Array.isArray(parsed)) return
      const [verb, subId, filter] = parsed as [string, string, Record<string, unknown> | undefined]
      if (verb === 'EVENT') {
        const id = (parsed[1] as { id?: string } | undefined)?.id ?? ''
        ws.send(JSON.stringify(['OK', id, true, '']))
        return
      }
      if (verb !== 'REQ') return
      const kinds = (filter?.['kinds'] as number[] | undefined) ?? []
      if (kinds.includes(38000)) {
        for (const actor of ACTORS) ws.send(JSON.stringify(['EVENT', subId, actor.reviewEvent]))
        ws.send(JSON.stringify(['EOSE', subId]))
      } else if (kinds.includes(0)) {
        const authors = new Set((filter?.['authors'] as string[] | undefined) ?? [])
        for (const actor of ACTORS) {
          if (actor.profileEvent && authors.has(actor.pubkey)) {
            ws.send(JSON.stringify(['EVENT', subId, actor.profileEvent]))
          }
        }
        ws.send(JSON.stringify(['EOSE', subId]))
      } else {
        ws.send(JSON.stringify(['EOSE', subId]))
      }
    })
  })
}

test.beforeEach(async ({ page }) => {
  await mockReviewRelays(page)
  await installApiMocks(page)
  // The Reviews list is built from the DB-backed endpoint (live relay-only events
  // are no longer added, so the page count matches the card). Serve the same corpus
  // there; the relay stub above still supplies the kind:0 profiles for named actors.
  await page.route('**/api/mints/nostr-reviews**', route => route.fulfill({
    json: ACTORS.map(a => {
      const rating = a.reviewEvent.tags.find(t => t[0] === 'rating')?.[1]
      return {
        id: a.reviewEvent.id,
        pubkey: a.pubkey,
        content: a.reviewEvent.content,
        rating: rating !== undefined ? Number(rating) : null,
        createdAt: a.reviewEvent.created_at,
        source: 'nostr',
      }
    }),
  }))
  await page.goto(detailPath)
  await expect(page.locator('.md-tabs')).toBeVisible()
  await page.locator('.md-tab', { hasText: 'Reviews' }).click()
  await expect(page.locator('.reviews-filter-chip').first()).toBeVisible({ timeout: 15_000 })
})

test.describe('Mint Detail — Reviews filters (large corpus)', () => {
  // Visible text in the summary since the 2026-11-19 redesign (it was a "Reviews · NIP-87" label with a tooltip).
  test('the NIP-87 sentence and the caveat are visible in the summary beside the list', async ({ page }) => {
    const note = page.locator('.md-rv-sum .reviews-disclaimer').first()
    await expect(note).toContainText('signed Nostr events (NIP-87)')
    await expect(note).toContainText(/ratings can be inflated\. Treat them as a hint, not proof/i)
    await expect(note.locator('.info-tooltip')).toHaveCount(0)
  })

  // A check box since the 2026-11-19 redesign; on a phone it wraps under the filter switch, flush left with it.
  test('Hide anonymous is a check box, flush left with All at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    const all = page.locator('.reviews-filter-group')
    const hide = page.locator('.md-rv-toggle')
    await expect(all).toBeVisible()
    await expect(hide).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /Hide anonymous/ })).not.toBeChecked()
    const leftAll = await all.evaluate(e => e.getBoundingClientRect().left)
    const leftHide = await hide.evaluate(e => e.getBoundingClientRect().left)
    expect(Math.abs(leftHide - leftAll)).toBeLessThanOrEqual(1)
  })

  test('chip counts match the underlying dataset', async ({ page }) => {
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveText(`All ${TOTAL}`)
    await expect(page.locator('.reviews-filter-chip', { hasText: '5 stars' })).toHaveText(`5 stars ${FIVE_STAR_COUNT}`)
    await expect(page.locator('.reviews-filter-chip', { hasText: 'Critical' })).toHaveText(`Critical ${CRITICAL_COUNT}`)
    await expect(page.locator('.md-rv-toggle')).toHaveText(`Hide anonymous (${ANON_COUNT})`)
  })

  test('Hide anon recomputes the All/5★/Critical chip counts to the named-only subset', async ({ page }) => {
    // Baseline (Hide anon off) — full-corpus counts, same as the previous test.
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveText(`All ${TOTAL}`)
    await expect(page.locator('.reviews-filter-chip', { hasText: '5 stars' })).toHaveText(`5 stars ${FIVE_STAR_COUNT}`)
    await expect(page.locator('.reviews-filter-chip', { hasText: 'Critical' })).toHaveText(`Critical ${CRITICAL_COUNT}`)

    await page.getByRole('checkbox', { name: /Hide anonymous/ }).click()

    // All three exclusive chips must now reflect the named-only subset, matching
    // exactly what the list below renders for each filter — not the stale
    // full-corpus counts.
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveText(`All ${NAMED_COUNT}`)
    await expect(page.locator('.reviews-filter-chip', { hasText: '5 stars' })).toHaveText(`5 stars ${FIVE_STAR_NAMED_COUNT}`)
    await expect(page.locator('.reviews-filter-chip', { hasText: 'Critical' })).toHaveText(`Critical ${CRITICAL_NAMED_COUNT}`)

    // Cross-check each chip's number against the actual rendered list count for
    // that combination (All+Hide anon, 5★+Hide anon, Critical+Hide anon).
    const totalPagesAll = Math.ceil(NAMED_COUNT / 5)
    await expect(page.locator('.reviews-page-of')).toContainText(`of ${totalPagesAll}`)
    await expect(page.locator('.review-card')).toHaveCount(Math.min(NAMED_COUNT, 5))

    await page.locator('.reviews-filter-chip', { hasText: '5 stars' }).click()
    await expect(page.locator('.review-card')).toHaveCount(Math.min(FIVE_STAR_NAMED_COUNT, 5))
    const totalPagesFive = Math.max(1, Math.ceil(FIVE_STAR_NAMED_COUNT / 5))
    if (totalPagesFive > 1) {
      await expect(page.locator('.reviews-page-of')).toContainText(`of ${totalPagesFive}`)
    }

    await page.locator('.reviews-filter-chip', { hasText: 'Critical' }).click()
    await expect(page.locator('.review-card')).toHaveCount(CRITICAL_NAMED_COUNT) // 0, by fixture design
    await expect(page.getByText('No reviews match this filter.')).toBeVisible()

    // Turning Hide anon back off restores the original full-corpus counts.
    await page.getByRole('checkbox', { name: /Hide anonymous/ }).click()
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveText(`All ${TOTAL}`)
    await expect(page.locator('.reviews-filter-chip', { hasText: '5 stars' })).toHaveText(`5 stars ${FIVE_STAR_COUNT}`)
    await expect(page.locator('.reviews-filter-chip', { hasText: 'Critical' })).toHaveText(`Critical ${CRITICAL_COUNT}`)
  })

  test('All is active by default and shows the full paginated list', async ({ page }) => {
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveClass(/active/)
    const totalPages = Math.ceil(TOTAL / 5)
    await expect(page.locator('.reviews-page-of')).toContainText('Page 1 of')
    await expect(page.locator('.review-card')).toHaveCount(5)
    await expect(page.locator('.reviews-page-of')).toContainText(`of ${totalPages}`)
  })

  test('5★ filter is exclusive with All/Critical and repaginates to page 1', async ({ page }) => {
    // Move off page 1 first, to prove the filter click resets pagination. The
    // numbered pager windows around the current page (see reviewPageList()), so
    // with 21 total pages only "1", "2", "…", "21" are visible from page 1 —
    // reach page 3 via "next" instead of assuming a "3" button is on screen.
    await page.locator('.reviews-page-btn[aria-label="Next page"]').click()
    await page.locator('.reviews-page-btn[aria-label="Next page"]').click()
    await expect(page.locator('.reviews-page-of')).toContainText('Page 3 of')

    await page.locator('.reviews-filter-chip', { hasText: '5 stars' }).click()
    await expect(page.locator('.reviews-filter-chip', { hasText: '5 stars' })).toHaveClass(/active/)
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).not.toHaveClass(/active/)
    await expect(page.locator('.review-card')).toHaveCount(5)
    await expect(page.locator('.reviews-page-of')).toContainText('Page 1 of')
  })

  test('Critical filter shows only rating<=2 reviews, never a rating-less one', async ({ page }) => {
    await page.locator('.reviews-filter-chip', { hasText: 'Critical' }).click()
    const totalPages = Math.max(1, Math.ceil(CRITICAL_COUNT / 5))
    const expectedFirstPage = Math.min(CRITICAL_COUNT, 5)
    await expect(page.locator('.review-card')).toHaveCount(expectedFirstPage)
    for (let i = 0; i < expectedFirstPage; i++) {
      await expect(page.locator('.review-card').nth(i).locator('.review-stars')).toBeVisible()
    }
    if (totalPages > 1) {
      await expect(page.locator('.reviews-page-of')).toContainText(`of ${totalPages}`)
    }
  })

  test('Hide anon combines with the active exclusive filter (5★ + Hide anon)', async ({ page }) => {
    await page.locator('.reviews-filter-chip', { hasText: '5 stars' }).click()
    await page.getByRole('checkbox', { name: /Hide anonymous/ }).click()
    await expect(page.getByRole('checkbox', { name: /Hide anonymous/ })).toBeChecked()
    const totalPages = Math.max(1, Math.ceil(FIVE_STAR_NAMED_COUNT / 5))
    await expect(page.locator('.review-card')).toHaveCount(Math.min(FIVE_STAR_NAMED_COUNT, 5))
    if (totalPages > 1) {
      await expect(page.locator('.reviews-page-of')).toContainText(`of ${totalPages}`)
    }
  })

  test('Hide anon combines with All (no rating filter applied)', async ({ page }) => {
    await page.getByRole('checkbox', { name: /Hide anonymous/ }).click()
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toHaveClass(/active/)
    await expect(page.getByRole('checkbox', { name: /Hide anonymous/ })).toBeChecked()
    const totalPages = Math.ceil(NAMED_COUNT / 5)
    await expect(page.locator('.reviews-page-of')).toContainText(`of ${totalPages}`)
  })

  test('Critical + Hide anon has zero matches (all critical reviews are anonymous) and shows the filtered-empty message', async ({ page }) => {
    expect(CRITICAL_NAMED_COUNT).toBe(0) // sanity check on the fixture data itself
    await page.locator('.reviews-filter-chip', { hasText: 'Critical' }).click()
    // CRITICAL_COUNT (6) exceeds REVIEWS_PER_PAGE (5), so only page 1's worth shows.
    await expect(page.locator('.review-card')).toHaveCount(Math.min(CRITICAL_COUNT, 5))

    await page.getByRole('checkbox', { name: /Hide anonymous/ }).click()
    await expect(page.locator('.review-card')).toHaveCount(0)
    await expect(page.getByText('No reviews match this filter.')).toBeVisible()
    // The chips themselves stay visible and interactive so the user can recover.
    await expect(page.locator('.reviews-filter-chip', { hasText: 'All' })).toBeVisible()

    // Switching back to All (still with Hide anon on) shows results again — proves
    // the empty state isn't a dead end.
    await page.locator('.reviews-filter-chip', { hasText: 'All' }).click()
    await expect(page.locator('.review-card').first()).toBeVisible()
  })
})
