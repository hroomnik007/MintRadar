// Version of the Reliability Score methodology, sent in the wallet API envelope (docs/API.md) and shown with
// its change log on the /methodology page.
//
// Bump METHODOLOGY_VERSION and append a METHODOLOGY_CHANGES entry in the SAME commit as any change to the
// formula (component weights, the audit rule, the version rule, the new-mint cap). This file has no imports,
// so the frontend copy src/utils/methodology.ts is byte-identical (code, comments aside);
// src/__tests__/sharedModules.test.ts fails when they drift.

export const METHODOLOGY_VERSION = 8

export interface MethodologyChange {
  version: number
  /** Date the formula went live, YYYY-MM-DD. */
  date: string
  summary: string
}

export const METHODOLOGY_CHANGES: readonly MethodologyChange[] = [
  { version: 1, date: '2026-09-12', summary: 'Initial formula: uptime 40, audit 25 (audit.8333.space), NUTs 15, software version 15, contact 5; new mints capped at 75 for 30 days.' },
  { version: 2, date: '2026-10-08', summary: 'Audit part now from cashu.info: failures attributed to the mint divided by swaps in 7 days; neutral under 10 swaps or without recent data.' },
  { version: 3, date: '2026-10-09', summary: 'Version part follows one rule: outdated means two or more minor versions behind the newest stable release; zero or one behind scores full points.' },
  { version: 4, date: '2026-10-21', summary: 'NUT part: a NUT entry with "supported": false in /v1/info no longer counts as support for the NUT component; a NUT counts when the mint lists it and does not mark it as not supported.' },
  { version: 5, date: '2026-10-27', summary: 'NUT part: a NUT the mint has switched off (NUT-04 minting or NUT-05 melting with "disabled": true in /v1/info) no longer counts for the NUT component.' },
  { version: 6, date: '2026-10-28', summary: 'Recommendation gate: a mint is eligible only if its newest probe is at most 3 hours old; the score formula is unchanged.' },
  { version: 7, date: '2026-11-10', summary: 'Uptime part (40) now has four parts: last 24 hours 20, last 30 days 10, longest outage in 30 days 6, number of outages in 30 days 4. Recommendation gate: at least 95% uptime in 30 days.' },
  { version: 8, date: '2026-11-13', summary: 'Audit part: the worse result of two windows, the last 7 days and up to 28 days (four 7-day totals that do not overlap, stored from 2026-11-13 on). A failure blamed on the mint now counts for up to 28 days instead of 7; a window with fewer than 10 swaps is not used.' },
]