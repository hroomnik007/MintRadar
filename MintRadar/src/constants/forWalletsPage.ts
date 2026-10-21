// Facts and code examples of the /for-wallets page (pages/ForWallets.tsx), as data. The tables of the page come
// from utils/walletFields.ts; src/__tests__/forWalletsPage.test.tsx compares the quoted numbers with the backend
// and checks that every example uses only documented parameters, headers and paths.

import { REPO_BLOB_URL } from '@/constants/contact'

export const WALLET_API_BASE = 'https://mintradar.org/api/v1'
export const EXAMPLE_MINT_URL = 'https://mint.minibits.cash/Bitcoin'

/** How often the polling example refreshes; it must not be shorter than WALLET_API_FACTS.pollMinutes. */
export const EXAMPLE_POLL_MINUTES = 10

export const WALLET_API_FACTS = {
  /** Poll no more often than this (the data follows the 5-minute probe cycle; Cache-Control max-age is 300). */
  pollMinutes: 5,
  cacheMaxAgeSeconds: 300,
  rateLimitPerMinute: 300,
  deprecationNoticeDays: 90,
  /** GET /api/v1/mints/recommend: deprecated on this day, may be removed from the sunset day (backend/src/deprecation.ts). */
  recommendDeprecatedOn: '2026-10-20',
  recommendSunsetOn: '2027-01-26',
  /** The day the second batch of additive fields and parameters (method, maxInputFeePpk, include, facts, keysets, breakdown) was added. */
  walletAdditionsOn: '2026-10-20',
  /** The day the facts feeExamples, limits and auditByDirection were added (single-mint endpoint and include=facts). */
  walletFactsAddedOn: '2026-10-21',
  /** The list query that returns the same mints as /mints/recommend with its defaults. */
  recommendReplacementQuery: '/wallets/mints?eligible=true&unit=sat&minScore=80&limit=5',
} as const

export const DOCS_API_URL = `${REPO_BLOB_URL}/docs/API.md`
export const DOCS_OPENAPI_URL = `${REPO_BLOB_URL}/docs/openapi/wallets-v1.yaml`

export interface WalletExample {
  id: string
  /** Heading of the block and the base of its accessible names. */
  title: string
  language: 'bash' | 'js'
  code: string
}

const listUrl = `${WALLET_API_BASE}/wallets/mints?unit=sat&minScore=70`
const oneUrl = `${WALLET_API_BASE}/wallets/mints/${encodeURIComponent(EXAMPLE_MINT_URL)}`

export const WALLET_EXAMPLES: readonly WalletExample[] = [
  {
    id: 'list-curl',
    title: 'List sat mints with a score of 70 or more (curl)',
    language: 'bash',
    code: `curl -s "${listUrl}"`,
  },
  {
    id: 'list-fetch',
    title: 'List sat mints with a score of 70 or more (fetch)',
    language: 'js',
    code: `const res = await fetch('${listUrl}')
if (!res.ok) throw new Error((await res.json()).error.message)
const { methodology, generatedAt, mints } = await res.json()
for (const m of mints) {
  console.log(m.score, m.name ?? new URL(m.url).hostname, m.status)
}`,
  },
  {
    id: 'one-curl',
    title: 'One mint by its percent-encoded URL (curl)',
    language: 'bash',
    code: `curl -s "${oneUrl}"`,
  },
  {
    id: 'one-fetch',
    title: 'One mint by its percent-encoded URL (fetch)',
    language: 'js',
    code: `const mintUrl = '${EXAMPLE_MINT_URL}'
const res = await fetch('${WALLET_API_BASE}/wallets/mints/' + encodeURIComponent(mintUrl))
if (res.status === 404) {
  // a 404 mint_not_found: MintRadar does not track this mint
} else if (!res.ok) {
  throw new Error((await res.json()).error.message)
} else {
  const { mint } = await res.json()
  console.log(mint.score, mint.status)
}`,
  },
  {
    id: 'poll-fetch',
    title: 'Polling with ETag and If-None-Match (fetch)',
    language: 'js',
    code: `let etag = null
let latest = null

async function refresh() {
  const res = await fetch('${listUrl}', {
    headers: etag ? { 'If-None-Match': etag } : {},
  })
  if (res.status === 304) return latest // unchanged: no body
  if (!res.ok) throw new Error((await res.json()).error.message)
  etag = res.headers.get('ETag')
  latest = await res.json()
  return latest
}

refresh() // first request right away
setInterval(refresh, ${EXAMPLE_POLL_MINUTES} * 60 * 1000) // every ${EXAMPLE_POLL_MINUTES} minutes`,
  },
]
