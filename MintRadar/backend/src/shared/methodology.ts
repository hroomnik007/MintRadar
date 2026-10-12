// Version of the Reliability Score methodology, sent in the wallet API envelope (docs/API.md) and shown with
// its change log on the /methodology page.
//
// Bump METHODOLOGY_VERSION and append a METHODOLOGY_CHANGES entry in the SAME commit as any change to the
// formula (component weights, the audit rule, the version rule, the new-mint cap). This file has no imports,
// so the frontend copy src/utils/methodology.ts is byte-identical (code, comments aside);
// src/__tests__/sharedModules.test.ts fails when they drift.

export const METHODOLOGY_VERSION = 3

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
]
