import { describe, it, expect } from 'vitest'
import type { Response } from 'express'
import {
  RECOMMEND_DEPRECATION, deprecationHeaderValue, sunsetHeaderValue, setDeprecationHeaders, type DeprecationInfo,
} from '../deprecation.js'

// The published promise (docs/API.md "Stability", /for-wallets#stability) is a notice of at least 90 days before a
// removal. The Sunset date is a constant in deprecation.ts; this test fails when it is moved closer than that.
const MIN_NOTICE_DAYS = 90
const DAY_MS = 86_400_000
const day = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime()

describe('RECOMMEND_DEPRECATION', () => {
  it(`Sunset is at least ${MIN_NOTICE_DAYS} days after the Deprecation date`, () => {
    const days = (day(RECOMMEND_DEPRECATION.sunsetOn) - day(RECOMMEND_DEPRECATION.deprecatedOn)) / DAY_MS
    expect(days).toBeGreaterThanOrEqual(MIN_NOTICE_DAYS)
  })

  it('names an absolute https successor on the wallet API with the eligible filter', () => {
    const u = new URL(RECOMMEND_DEPRECATION.successorUrl)
    expect(u.protocol).toBe('https:')
    expect(u.pathname).toBe('/api/v1/wallets/mints')
    expect(u.searchParams.get('eligible')).toBe('true')
  })
})

describe('header values', () => {
  const info: DeprecationInfo = { deprecatedOn: '2026-10-20', sunsetOn: '2027-01-26', successorUrl: 'https://example.test/next' }

  it('Deprecation is "@" and the unix seconds of the day (RFC 9745)', () => {
    expect(deprecationHeaderValue(info)).toBe('@1792454400')
    expect(deprecationHeaderValue(info)).toMatch(/^@\d+$/)
  })

  it('Sunset is an HTTP-date', () => {
    expect(sunsetHeaderValue(info)).toBe('Tue, 26 Jan 2027 00:00:00 GMT')
  })

  it('setDeprecationHeaders sets the three headers and keeps an existing Link', () => {
    const headers: Record<string, string | string[]> = { Link: '<https://example.test/prev>; rel="prev"' }
    const res = {
      setHeader: (k: string, v: string) => { headers[k] = v },
      append: (k: string, v: string) => { const cur = headers[k]; headers[k] = cur === undefined ? v : [...(Array.isArray(cur) ? cur : [cur]), v] },
    } as unknown as Response
    setDeprecationHeaders(res, info)
    expect(headers['Deprecation']).toBe('@1792454400')
    expect(headers['Sunset']).toBe('Tue, 26 Jan 2027 00:00:00 GMT')
    expect(headers['Link']).toEqual(['<https://example.test/prev>; rel="prev"', '<https://example.test/next>; rel="successor-version"'])
  })
})
