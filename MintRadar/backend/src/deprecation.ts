import type { Response } from 'express'

// Deprecation signalling for a v1 route (RFC 9745 `Deprecation`, RFC 8594 `Sunset`, RFC 8288 `Link: rel="successor-version"`).
// The published promise (docs/API.md "Stability") is a notice of at least 90 days before anything is removed; the
// Sunset date below is chosen with margin, and deprecation.test.ts fails when the gap is ever smaller.

export interface DeprecationInfo {
  /** The day the route was deprecated (the production deploy day), UTC midnight, as an ISO date. */
  deprecatedOn: string
  /** The day it may be removed, UTC midnight, as an ISO date. */
  sunsetOn: string
  /** Absolute URL of the replacement. */
  successorUrl: string
}

/** GET /api/v1/mints/recommend (and its unversioned alias): replaced by the wallet list with eligible=true. */
export const RECOMMEND_DEPRECATION: DeprecationInfo = {
  deprecatedOn: '2026-10-20',
  sunsetOn: '2027-01-26',
  successorUrl: 'https://mintradar.org/api/v1/wallets/mints?eligible=true&unit=sat&minScore=80&limit=5',
}

const toDate = (isoDay: string): Date => new Date(`${isoDay}T00:00:00Z`)

/** `@<unix seconds>`, the RFC 9745 form of the Deprecation header. */
export function deprecationHeaderValue(info: DeprecationInfo): string {
  return `@${Math.floor(toDate(info.deprecatedOn).getTime() / 1000)}`
}

/** An HTTP-date, the form of the Sunset header. */
export function sunsetHeaderValue(info: DeprecationInfo): string {
  return toDate(info.sunsetOn).toUTCString()
}

export function setDeprecationHeaders(res: Response, info: DeprecationInfo): void {
  res.setHeader('Deprecation', deprecationHeaderValue(info))
  res.setHeader('Sunset', sunsetHeaderValue(info))
  res.append('Link', `<${info.successorUrl}>; rel="successor-version"`)
}
