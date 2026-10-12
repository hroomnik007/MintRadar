// The /methodology page quotes numbers (constants/methodologyPage.ts). Each of them is compared here with the code
// that computes the score, so changing a constant without updating the page fails. The change log is compared with
// METHODOLOGY_CHANGES, the contact card with About.tsx.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { METHODOLOGY_PAGE as M } from '@/constants/methodologyPage'
import { CONTACT_NIP05, CONTACT_NPUB, REPO_URL } from '@/constants/contact'
import { PROBE_LOCATION } from '@/constants/probeLocation'
import { TRACKED_NUT_KEYS as feTrackedNutKeys } from '@/constants/nuts'
import { METHODOLOGY_CHANGES, METHODOLOGY_VERSION } from '@/utils/methodology'
import {
  uptimeComponent, nutComponent, versionComponent, contactComponent, applyNewMintCap, isEligibleForRecommendation,
  NEW_MINT_MAX_DAYS, NEW_MINT_RELIABILITY_CAP, MIN_RECOMMENDATION_AGE_DAYS, TRACKED_NUT_COUNT,
} from '@/utils/reliabilityScore'
import { auditComponent, AUDIT_MIN_SAMPLES, AUDIT_MAX_AGE_HOURS, AUDIT_NEUTRAL } from '@/utils/auditScore'
import {
  classifyVersion, canonicalSoftwareName, pointsForMinorsBehind, MIN_MINTS_FOR_FALLBACK_LATEST,
  UNKNOWN_SOFTWARE_POINTS, UNPARSABLE_VERSION_POINTS,
} from '@/utils/versionRule'
import * as be from '../../backend/src/shared/reliabilityScore'
import { METHODOLOGY_VERSION as beVersion, METHODOLOGY_CHANGES as beChanges } from '../../backend/src/shared/methodology'
import Methodology from '@/pages/Methodology'

vi.mock('../../backend/src/db.js', () => ({ pool: { query: vi.fn() } }))

const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')
const DAY = 86_400_000
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 9, 13, 12, 0, 0)

describe('weights', () => {
  it('each component reaches exactly its quoted maximum and the maxima add up to 100', () => {
    const latest = { nutshell: { major: 0, minor: 21 } }
    expect(uptimeComponent(100)).toBe(M.weights.uptime)
    expect(auditComponent(0, 100, new Date(NOW), NOW)).toBe(M.weights.audit)
    expect(nutComponent(TRACKED_NUT_COUNT)).toBe(M.weights.nuts)
    expect(versionComponent('Nutshell/0.21.0', latest)).toBe(M.weights.version)
    expect(contactComponent(M.contact.maxChannels)).toBe(M.weights.contact)
    expect(Object.values(M.weights).reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('the backend copy agrees', () => {
    expect(be.uptimeComponent(100)).toBe(M.weights.uptime)
    expect(be.nutComponent(be.TRACKED_NUT_COUNT)).toBe(M.weights.nuts)
    expect(be.contactComponent(M.contact.maxChannels)).toBe(M.weights.contact)
  })
})

describe('uptime', () => {
  it('points = round(percent x factor) for every whole percent', () => {
    for (let p = 0; p <= 100; p++) expect(uptimeComponent(p)).toBe(Math.round(p * M.uptime.factor))
  })
  it('the window and the cadence are the ones in the prober and the cron', () => {
    expect(read('../../backend/src/prober.ts')).toContain(`INTERVAL '${M.uptime.windowHours} hours'`)
    expect(read('../../backend/src/prober.ts')).toContain(`const PROBE_TIMEOUT_MS = ${M.cadence.probeTimeoutSeconds}000`)
    expect(read('../../backend/src/cron.ts')).toContain(`cron.schedule('*/${M.cadence.probeMinutes} * * * *'`)
    expect(PROBE_LOCATION).toBe('Nuremberg')
  })
})

describe('audit', () => {
  const total = 1000
  const score = (blamed: number | null, n: number | null = total, fetchedAt: Date | null = new Date(NOW)) =>
    auditComponent(blamed, n, fetchedAt, NOW)

  it('minimum swaps, freshness and neutral value equal the code constants', () => {
    expect(M.audit.minSwaps).toBe(AUDIT_MIN_SAMPLES)
    expect(M.audit.maxAgeHours).toBe(AUDIT_MAX_AGE_HOURS)
    expect(M.audit.maxAgeHours).toBe(M.audit.windowDays * 24)
    expect(M.audit.neutral).toBe(AUDIT_NEUTRAL)
    expect(M.audit.neutral).toBe(M.weights.audit / 2)
  })

  it('neutral under the minimum, without data and when older than the freshness limit', () => {
    expect(score(0, M.audit.minSwaps - 1)).toBe(M.audit.neutral)
    expect(score(0, M.audit.minSwaps)).toBe(M.audit.bands[0]!.points)
    expect(score(null)).toBe(M.audit.neutral)
    expect(score(0, null)).toBe(M.audit.neutral)
    expect(score(0, total, null)).toBe(M.audit.neutral)
    expect(score(0, total, new Date(NOW - M.audit.maxAgeHours * HOUR))).toBe(M.audit.bands[0]!.points)
    expect(score(0, total, new Date(NOW - M.audit.maxAgeHours * HOUR - 1))).toBe(M.audit.neutral)
  })

  it('the bands and their edges (the rate exactly on a bound belongs to the next band)', () => {
    const b = M.audit.bands
    expect(score(0)).toBe(b[0]!.points)
    expect(b[0]!.zero).toBe(true)
    for (let i = 1; i < b.length - 1; i++) {
      const bound = b[i]!.below as number
      expect(score(bound * total - 1)).toBe(b[i]!.points)
      expect(score(bound * total)).toBe(b[i + 1]!.points)
    }
    expect(score(1)).toBe(b[1]!.points) // 0.1 %
    expect(score(total)).toBe(b[b.length - 1]!.points)
    expect(score(total * 2)).toBe(b[b.length - 1]!.points) // above the total is clamped to the total
    expect(b[b.length - 1]!.below).toBeNull()
  })
})

describe('NUT support', () => {
  it('the quoted list is the tracked list of both packages', () => {
    expect([...M.nuts.tracked]).toEqual(be.TRACKED_NUT_KEYS)
    expect([...M.nuts.tracked]).toEqual(feTrackedNutKeys)
    expect(M.nuts.tracked.length).toBe(TRACKED_NUT_COUNT)
  })
})

describe('software version rule', () => {
  const latest = { major: 0, minor: 21 }
  const behind = (n: number) => classifyVersion('Nutshell', `0.${21 - n}.0`, latest)

  it('outdated from the quoted number of minor versions behind, points by the quoted table', () => {
    for (let n = 0; n <= 6; n++) {
      expect(behind(n).label === 'outdated', `${n} behind`).toBe(n >= M.version.outdatedFromMinorsBehind)
    }
    M.version.pointsByMinorsBehind.forEach((pts, n) => {
      expect(behind(n).points, `${n} behind`).toBe(pts)
      expect(pointsForMinorsBehind(n)).toBe(pts)
    })
    expect(behind(M.version.pointsByMinorsBehind.length).points).toBe(M.version.pointsFiveOrMoreBehind)
    expect(behind(6).points).toBe(M.version.pointsFiveOrMoreBehind)
    expect(classifyVersion('Nutshell', '0.20.0', latest).points).toBe(M.weights.version) // one behind: full points
    expect(classifyVersion('Nutshell', '0.22.0', latest).points).toBe(M.weights.version) // ahead counts as current
    expect(classifyVersion('Nutshell', '0.21.0-rc.1', latest).label).toBeNull() // a pre-release is never "latest"
    expect(classifyVersion('Nutshell', '0.19.0-rc.1', latest).label).toBe('outdated')
  })

  it('points for unknown software, unreadable and missing versions, and a family without a newest release', () => {
    expect(classifyVersion('LekMint', '1.0.0', latest).points).toBe(M.version.pointsUnknownSoftware)
    expect(UNKNOWN_SOFTWARE_POINTS).toBe(M.version.pointsUnknownSoftware)
    expect(classifyVersion('Nutshell', 'not-a-version', latest).points).toBe(M.version.pointsUnreadableVersion)
    expect(UNPARSABLE_VERSION_POINTS).toBe(M.version.pointsUnreadableVersion)
    expect(classifyVersion(null, null, null).points).toBe(M.version.pointsNoVersion)
    expect(classifyVersion('Nutshell', '0.21.0', null).points).toBe(M.version.pointsUnknownSoftware)
  })

  it('the recognised families and the fallback minimum', () => {
    expect(canonicalSoftwareName('Nutshell')).toBe('nutshell')
    expect(canonicalSoftwareName('cdk')).toBe('cdk')
    expect(canonicalSoftwareName('cdk-mintd')).toBe('cdk')
    expect(M.version.families).toEqual(['Nutshell', 'cdk / cdk-mintd'])
    expect(M.version.fallbackMinMints).toBe(MIN_MINTS_FOR_FALLBACK_LATEST)
  })

  it('the release grace period and the refresh cadence equal the version catalog and the cron', async () => {
    const { VERSION_GRACE_PERIOD_MS } = await import('../../backend/src/versionCatalog')
    expect(VERSION_GRACE_PERIOD_MS).toBe(M.version.releaseGraceDays * DAY)
    const cron = read('../../backend/src/cron.ts')
    const at = cron.indexOf('fetchLatestUpstreamVersions()')
    expect(cron.slice(cron.lastIndexOf('cron.schedule(', at), at)).toContain("cron.schedule('45 3 * * *'")
    expect(M.cadence.catalogHours).toBe(24)
  })
})

describe('contact', () => {
  it('counts at most the quoted number of channels', () => {
    expect(contactComponent(M.contact.maxChannels)).toBe(M.weights.contact)
    expect(contactComponent(M.contact.maxChannels + 57)).toBe(M.weights.contact)
    expect(contactComponent(M.contact.maxChannels - 1)).toBeLessThan(M.weights.contact)
  })
})

describe('cap and gate', () => {
  it('the cap and its days equal the code constants, in both packages', () => {
    expect(M.newMint.capPoints).toBe(NEW_MINT_RELIABILITY_CAP)
    expect(M.newMint.capDays).toBe(NEW_MINT_MAX_DAYS)
    expect(M.newMint.capPoints).toBe(be.NEW_MINT_RELIABILITY_CAP)
    expect(M.newMint.capDays).toBe(be.NEW_MINT_MAX_DAYS)
    const first = (days: number) => new Date(NOW - days * DAY).toISOString()
    expect(applyNewMintCap(100, first(M.newMint.capDays - 1), NOW)).toBe(M.newMint.capPoints)
    expect(applyNewMintCap(100, first(M.newMint.capDays), NOW)).toBe(100)
  })

  it('the recommendation gate equals the code constant, in both packages', () => {
    expect(M.recommendation.minAgeDays).toBe(MIN_RECOMMENDATION_AGE_DAYS)
    expect(M.recommendation.minAgeDays).toBe(be.MIN_RECOMMENDATION_AGE_DAYS)
    const first = (days: number) => new Date(NOW - days * DAY).toISOString()
    expect(isEligibleForRecommendation(first(M.recommendation.minAgeDays), NOW)).toBe(true)
    expect(isEligibleForRecommendation(first(M.recommendation.minAgeDays), NOW - 1)).toBe(false)
  })
})

describe('cadence', () => {
  it('cashu.info detail every 30 minutes (minutes 8 and 38) and a 60 second API snapshot', () => {
    const cron = read('../../backend/src/cron.ts')
    expect(M.cadence.detailMinutes).toBe(30)
    expect(cron).toContain("cron.schedule('8,38 * * * *'")
    expect(read('../../backend/src/index.ts')).toContain(`const KNOWN_MINTS_CACHE_TTL = ${M.cadence.snapshotSeconds}_000`)
  })
})

describe('change log and version', () => {
  it('the frontend copy of the methodology module equals the backend one', () => {
    expect(METHODOLOGY_VERSION).toBe(beVersion)
    expect(METHODOLOGY_CHANGES).toEqual(beChanges)
  })

  it('the current version is the highest entry and every version appears once', () => {
    const versions = METHODOLOGY_CHANGES.map(c => c.version)
    expect(Math.max(...versions)).toBe(METHODOLOGY_VERSION)
    expect(new Set(versions).size).toBe(versions.length)
  })

  function renderPage(): HTMLElement {
    const { container } = render(<MemoryRouter initialEntries={['/methodology']}><Methodology /></MemoryRouter>)
    return container
  }

  it('renders the log newest first, each entry with its version, date and summary', () => {
    const items = Array.from(renderPage().querySelectorAll<HTMLElement>('.doc-changelog li'))
    const expected = [...METHODOLOGY_CHANGES].sort((a, b) => b.version - a.version)
    expect(items.map(li => li.dataset['version'])).toEqual(expected.map(c => String(c.version)))
    items.forEach((li, i) => {
      expect(li.textContent).toContain(`Methodology ${expected[i]!.version}`)
      expect(li.textContent).toContain(expected[i]!.date)
      expect(li.textContent).toContain(expected[i]!.summary)
    })
  })

  it('shows the current version and the date of its entry', () => {
    const text = renderPage().querySelector('[data-testid="methodology-version"]')?.textContent ?? ''
    const entry = METHODOLOGY_CHANGES.find(c => c.version === METHODOLOGY_VERSION)!
    expect(text).toContain(`Methodology version ${METHODOLOGY_VERSION}`)
    expect(text).toContain(entry.date)
  })

  it('has exactly one h1 and quotes the numbers from the data', () => {
    const container = renderPage()
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    const text = container.textContent ?? ''
    for (const n of [M.audit.minSwaps, M.audit.maxAgeHours, M.audit.neutral, M.newMint.capPoints, M.newMint.capDays, M.recommendation.minAgeDays, M.version.releaseGraceDays]) {
      expect(text).toContain(String(n))
    }
  })
})

describe('contact card', () => {
  it('uses the npub, NIP-05 address and repository of the About page', () => {
    const about = read('../pages/About.tsx')
    expect(about).toContain(`const NPUB = '${CONTACT_NPUB}'`)
    expect(about).toContain(`const NIP05 = '${CONTACT_NIP05}'`)
    expect(about).toContain(`const REPO_URL = '${REPO_URL}'`)
  })
})
