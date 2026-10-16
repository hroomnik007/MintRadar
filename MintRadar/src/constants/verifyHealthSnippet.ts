// The code example of the /for-wallets section "Signed health assertions on Nostr": ONE source of truth. This exact
// text is shown on the page, is the file docs/examples/verify-health.mjs (the test fails when the two differ) and is
// the code backend/src/__tests__/verifyHealthSnippet.test.ts runs against stub relays and events from the real builder.
// It imports nothing but nostr-tools (the test checks that) and does not use nostr-tools' relay classes: their
// connection error handler calls close() from inside the error event and recurses without end on Node's WebSocket
// (RangeError after the result was printed), so each relay is read with a plain WebSocket and a manual REQ.
// The key and the relays are interpolated from the shared constants, so they exist in one place only. No template
// literal inside the snippet (it is itself one). After a change, rewrite the file with
//   UPDATE_VERIFY_HEALTH_EXAMPLE=1 npx vitest run src/__tests__/verifyHealthExampleFile.test.ts
// Relative imports on purpose: the backend test loads this file without the "@" alias.

import { ATTESTATION_NIP05, ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC } from '../utils/healthAssertionConstants'

const relayList = ATTESTATION_RELAYS_PUBLIC.map(r => `  '${r}',`).join('\n')

/** The one sentence about the runtime: shown on the page, as the first line of the code. */
export const VERIFY_HEALTH_RUNTIME_SENTENCE =
  'Runs in browsers and in Node 22 or newer; on older Node pass the ws package\'s WebSocket class as the webSocket option.'

export const VERIFY_HEALTH_FILE_NAME = 'verify-health.mjs'
export const VERIFY_HEALTH_INSTALL = `npm install nostr-tools\nnode ${VERIFY_HEALTH_FILE_NAME} https://mint.example.com`

export const VERIFY_HEALTH_SNIPPET = `// ${VERIFY_HEALTH_RUNTIME_SENTENCE}
// Verifies the MintRadar Health assertion (Nostr kind 30385) of one Cashu mint. Command line:
//   node ${VERIFY_HEALTH_FILE_NAME} <mint url> [relay url ...]
import { verifyEvent } from 'nostr-tools'

// Pin the provider key in your code. Confirm it once through NIP-05 (${ATTESTATION_NIP05}).
export const PINNED_PUBKEY = '${ATTESTATION_PUBKEY_HEX}'
export const RELAYS = [
${relayList}
]
export const KIND = 30385
const CONNECT_TIMEOUT_MS = 5000 // a relay that does not connect in 5 seconds is skipped
const READ_TIMEOUT_MS = 6000 // a relay that does not send EOSE in 6 seconds is skipped
const MAX_EVENTS_PER_RELAY = 100

// The d value for a mint URL: https, lower-case host, no default port, no trailing slash on a bare host, no fragment.
export function normalizeMintUrl(raw) {
  let parsed
  try { parsed = new URL(String(raw).trim()) } catch { return String(raw).trim() }
  parsed.protocol = 'https:'
  parsed.hostname = parsed.hostname.toLowerCase()
  parsed.hash = ''
  let result = parsed.toString()
  if (parsed.pathname === '/' && parsed.search === '') result = result.replace(/\\/$/, '')
  return result
}

// One event: null unless it is a current, valid assertion of the pinned key about THIS mint.
// Leave options.pubkey alone: the pinned key is the point. (It exists so that tests can use a throwaway key.)
export function checkHealthEvent(event, mintUrl, { pubkey = PINNED_PUBKEY, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!event || typeof event !== 'object' || !Array.isArray(event.tags)) return null
  const tag = (name) => event.tags.find((t) => Array.isArray(t) && t[0] === name)?.[1]
  const int = (name) => (/^\\d{1,12}$/.test(tag(name) ?? '') ? Number(tag(name)) : NaN) // digits only, else NaN
  try { if (!verifyEvent(event)) return null } catch { return null } // signature and id
  if (event.pubkey !== pubkey) return null // only the pinned key counts
  if (event.kind !== KIND) return null
  if (tag('d') !== normalizeMintUrl(mintUrl)) return null // never take the d of an event as another mint's identity
  if (tag('k') !== 'web') return null
  const expiration = int('expiration')
  if (!Number.isInteger(expiration) || expiration <= nowSec) return null // expired or missing: no current signal
  if (event.created_at > nowSec + 300) return null // created in the future
  const score = int('rank')
  const methodology = int('methodology')
  if (!Number.isInteger(score) || score > 100 || !Number.isInteger(methodology)) return null
  return {
    score, // rank: the Reliability Score, 0 to 100
    status: tag('mint_status'), // online | offline | degraded
    methodology, // scores of different methodology numbers are not comparable
    createdAt: event.created_at,
    expiresAt: expiration,
    tags: Object.fromEntries(event.tags.map((t) => [t[0], t[1] ?? ''])),
  }
}

// Reads one relay with a plain WebSocket and a manual REQ. It never rejects and never throws later: every path ends in
// finish(), which clears both timers and closes the socket. Resolves { events, ok, reason }; ok is true only after EOSE, otherwise reason says why not.
function queryRelay(url, filter, WebSocketClass) {
  return new Promise((resolve) => {
    const events = []
    const subId = 'h' + Math.random().toString(36).slice(2, 10)
    let ws = null
    let done = false
    let connectTimer = null
    let readTimer = null
    const finish = (ok, reason) => {
      if (done) return
      done = true
      clearTimeout(connectTimer)
      clearTimeout(readTimer)
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = null
        ws.onerror = () => {} // a no-op: a handler that calls close() again is what recurses in nostr-tools
        try { if (ws.readyState === 1) ws.send(JSON.stringify(['CLOSE', subId])) } catch { /* ignore */ }
        try { ws.close() } catch { /* ignore */ }
      }
      resolve({ events, ok, reason })
    }
    try { ws = new WebSocketClass(url) } catch { finish(false, 'invalid URL'); return }
    connectTimer = setTimeout(() => finish(false, 'no connection after ' + CONNECT_TIMEOUT_MS / 1000 + ' s'), CONNECT_TIMEOUT_MS)
    ws.onopen = () => {
      clearTimeout(connectTimer)
      readTimer = setTimeout(() => finish(false, 'no answer after ' + READ_TIMEOUT_MS / 1000 + ' s'), READ_TIMEOUT_MS)
      try { ws.send(JSON.stringify(['REQ', subId, filter])) } catch { finish(false, 'connection error') }
    }
    ws.onmessage = (message) => {
      let data
      try { data = JSON.parse(String(message.data)) } catch { return }
      if (!Array.isArray(data) || data[1] !== subId) return
      if (data[0] === 'EVENT') { if (events.length < MAX_EVENTS_PER_RELAY) events.push(data[2]) }
      else if (data[0] === 'EOSE') finish(true)
      else if (data[0] === 'CLOSED') finish(false, 'relay closed the subscription')
    }
    ws.onerror = () => finish(false, 'connection error')
    ws.onclose = () => finish(false, 'connection closed')
  })
}

// The newest valid assertion for a mint from all relays at once. It never throws. Returns
//   { health, answered, failed, reasons }: health is null when no relay has a valid event - that means "unknown", not "bad";
//   answered and failed list the relay URLs, so a partial failure is visible (reasons[url] says why a relay failed). Nothing answered at all: answered is [].
export async function getMintHealth(mintUrl, { relays = RELAYS, webSocket = globalThis.WebSocket, pubkey = PINNED_PUBKEY, nowSec } = {}) {
  const filter = { kinds: [KIND], authors: [pubkey], '#d': [normalizeMintUrl(mintUrl)] }
  const settled = await Promise.allSettled(
    relays.map((url) => (typeof webSocket === 'function' ? queryRelay(url, filter, webSocket) : Promise.resolve({ events: [], ok: false, reason: 'no WebSocket in this runtime' }))),
  )
  const answered = []
  const failed = []
  const reasons = {}
  let health = null
  settled.forEach((result, i) => {
    const value = result.status === 'fulfilled' ? result.value : { events: [], ok: false, reason: 'connection error' }
    ;(value.ok ? answered : failed).push(relays[i])
    if (!value.ok) reasons[relays[i]] = value.reason
    for (const event of value.events) {
      const checked = checkHealthEvent(event, mintUrl, { pubkey, nowSec })
      if (checked && (health === null || checked.createdAt > health.createdAt)) health = checked
    }
  })
  return { health, answered, failed, reasons }
}

// Command line: node ${VERIFY_HEALTH_FILE_NAME} <mint url> [relay url ...]
// Exit code 0 when at least one relay answered (also when no valid assertion exists), 1 when no relay answered, 2 for a usage error.
const argv = globalThis.process?.argv
if (argv && argv[1] && import.meta.url === new URL('file://' + argv[1]).href) {
  const host = (url) => { try { return new URL(url).host } catch { return url } }
  if (!argv[2]) {
    console.error('usage: node ${VERIFY_HEALTH_FILE_NAME} <mint url> [relay url ...]')
    globalThis.process.exitCode = 2
  } else {
    const { health, answered, failed, reasons } = await getMintHealth(argv[2], argv.length > 3 ? { relays: argv.slice(3) } : {})
    console.log('relays answered: ' + (answered.map(host).join(', ') || 'none'))
    for (const url of failed) console.log(host(url) + ': unreachable (' + reasons[url] + ')')
    if (answered.length === 0) {
      console.error('no relay answered' + (typeof globalThis.WebSocket === 'function' ? '' : ' (this runtime has no WebSocket: use Node 22 or newer)'))
      globalThis.process.exitCode = 1
    } else if (health === null) {
      console.log('no valid assertion found: unknown, not a bad mint')
    } else {
      console.log(JSON.stringify(health, null, 2))
      console.log('Operational health signal, not solvency, not a recommendation to deposit funds.')
    }
  }
}
`
