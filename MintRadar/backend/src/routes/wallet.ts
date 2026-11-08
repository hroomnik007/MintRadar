// Wallet API v1 (/api/wallets/*; docs/API.md "API for wallets", docs/openapi/wallets-v1.yaml).
import { Router } from 'express'
import { type Request, type Response, type NextFunction } from 'express'
import { isWellFormedMintUrl } from '../ssrf.js'
import { normalizeUrl } from '../discovery.js'
import { parseWalletListQuery, walletListEnvelope, walletSingleEnvelope, memoizedBody, sendCachedBody, sendWalletError, queryOf } from '../walletApi.js'
import { IS_DEV } from '../serverConfig.js'
import { loadKnownMints } from '../knownMintsSnapshot.js'

export const router = Router()

// ── Wallet API v1 (docs/API.md "API for wallets", docs/openapi/wallets-v1.yaml) ──────────────────────────────
// Served from the same snapshot as /api/mints/known (loadKnownMints), never one query per request. CORS and the
// 300/min limiter for /api/wallets/* are in the middleware above. Errors use { error: { code, message } }.
export const walletInternalError = (res: Response, route: string, err: unknown): void => {
  if (IS_DEV) console.error(route, err)
  sendWalletError(res, 500, 'internal_error', 'Internal server error')
}

router.get('/api/wallets/mints', (req: Request, res: Response): void => {
  const parsed = parseWalletListQuery(queryOf(req))
  if (!parsed.ok) {
    sendWalletError(res, 400, 'invalid_parameter', parsed.message)
    return
  }
  const f = parsed.filter
  loadKnownMints()
    .then(snap => sendCachedBody(res, memoizedBody(snap, `list|${JSON.stringify(f)}`, () => walletListEnvelope(snap, f))))
    .catch((err: unknown) => walletInternalError(res, '[/api/wallets/mints]', err))
})

// One mint: the rest of the path is the percent-encoded mint URL. A mount (not a :param route) so a malformed
// percent-encoding is ours to answer as JSON 400 instead of Express's HTML.
router.use('/api/wallets/mints/', (req: Request, res: Response, next: NextFunction): void => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return }
  let decoded: string
  try {
    decoded = decodeURIComponent(req.path.slice(1))
  } catch {
    sendWalletError(res, 400, 'invalid_url', 'The mint URL in the path is not valid percent-encoding')
    return
  }
  // normalizeUrl rewrites the scheme of any special URL to https (ftp://x, ws://x), which would turn a foreign scheme into
  // a 404 for a "valid" mint. Only http:// (normalised to https://) and https:// are accepted; nothing else is looked up.
  const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(decoded)?.[1]?.toLowerCase()
  if (scheme !== undefined && scheme !== 'http' && scheme !== 'https') {
    sendWalletError(res, 400, 'invalid_url', 'The URL scheme must be http or https')
    return
  }
  const url = normalizeUrl(decoded)
  if (!isWellFormedMintUrl(url)) {
    sendWalletError(res, 400, 'invalid_url', 'The path must be a percent-encoded https:// mint URL')
    return
  }
  loadKnownMints()
    .then(snap => {
      const body = walletSingleEnvelope(snap, url)
      if (body === null) {
        sendWalletError(res, 404, 'mint_not_found', 'No tracked mint has this URL')
        return
      }
      sendCachedBody(res, memoizedBody(snap, `mint|${url}`, () => body))
    })
    .catch((err: unknown) => walletInternalError(res, '[/api/wallets/mints/:url]', err))
})

router.use('/api/wallets', (_req: Request, res: Response): void => {
  sendWalletError(res, 404, 'not_found', 'Unknown wallet API route')
})
