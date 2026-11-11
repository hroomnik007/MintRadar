// POST /api/mint/submit and POST /api/mints/discover: new mints from visitors (rate limits in rateLimits.ts, new-mint
// caps in mintAdmission.ts).
import { Router } from 'express'
import { type Request, type Response } from 'express'
import { pool } from '../db.js'
import { isSafeUrl } from '../ssrf.js'
import { probeMintToDb, validateCashuMintProbe } from '../prober.js'
import { type ProbeErrorKind } from '../probeErrorKind.js'
import { normalizeMintPubkey, findMintsByPubkey, persistMintPubkeyIfChanged } from '../mintPubkey.js'
import { normalizeUrl } from '../discovery.js'
import { checkMintAdmission, rateLimitKey } from '../mintAdmission.js'
import { publicMintName } from '../mintNames.js'
import { isAllowlistMode, isAllowedUrl } from '../allowlist.js'
import { IS_DEV, MAX_URL_LENGTH } from '../serverConfig.js'
import { setRetryAfter, submitRateLimitStore, type DiscoverSource, discoverRateLimitStoreFor, checkSubmitRateLimit, checkDiscoverRateLimit } from '../rateLimits.js'
import { probeMint } from '../onDemandProbe.js'
import { invalidateKnownMints } from '../knownMintsSnapshot.js'

export const router = Router()

router.post('/api/mint/submit', (req: Request, res: Response): void => {
  const ip = rateLimitKey(req.ip ?? req.socket.remoteAddress)
  if (!checkSubmitRateLimit(ip)) {
    setRetryAfter(res, submitRateLimitStore, ip)
    res.status(429).json({ error: 'Too many requests. Try again later.' })
    return
  }

  const body = req.body as { url?: unknown }
  const url = body.url

  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Missing required field: url' })
    return
  }

  if (!isAllowedUrl(url)) {
    res.status(403).json({ error: 'This deployment monitors a fixed mint allowlist.' })
    return
  }

  if (!url.startsWith('https://')) {
    res.status(400).json({ error: 'url must start with https://' })
    return
  }

  if (url.length > MAX_URL_LENGTH) {
    res.status(400).json({ error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
    return
  }

  const normalized = normalizeUrl(url)

  isSafeUrl(normalized)
    .then(async safe => {
      if (!safe) {
        res.status(400).json({ error: 'Invalid url' })
        return
      }
      // Before the outbound probe: a URL past the new-mint caps costs no fetch (mintAdmission.ts).
      const admission = await checkMintAdmission(normalized, 'manual')
      if (!admission.ok) {
        res.status(403).json({ error: admission.error })
        return
      }
      const status = await probeMint(normalized)
      if (!status.online) {
        res.status(400).json({
          error: 'URL does not appear to be a valid Cashu mint',
          ...(status.errorKind !== undefined ? { errorKind: status.errorKind } : {}),
        })
        return
      }
      const result = await pool.query(
        `INSERT INTO mints (url, is_known, added_via) VALUES ($1, true, 'manual') ON CONFLICT (url) DO NOTHING`,
        [normalized]
      )
      const isNew = (result.rowCount ?? 0) > 0
      try {
        await probeMintToDb(normalized)
      } catch (probeErr) {
        if (IS_DEV) console.error('[submit] post-insert probe failed:', probeErr)
      }
      invalidateKnownMints()

      // Alias hint — never merges cards, URL stays the only identity. Only
      // meaningful for a genuinely new row; a re-submit of an already-tracked
      // URL doesn't need "is this an alias of itself" noise.
      let aliasOf: { url: string; name: string | null }[] = []
      if (isNew) {
        const pubkey = normalizeMintPubkey(status.info?.pubkey)
        if (pubkey !== null) {
          try {
            aliasOf = await findMintsByPubkey(pubkey, normalized)
          } catch (aliasErr) {
            if (IS_DEV) console.error('[submit] alias lookup failed:', aliasErr)
          }
        }
      }

      res.json({
        success: true,
        isNew,
        added: isNew,
        alreadyTracked: !isNew,
        name: publicMintName(status.info?.name, normalized).name,
        aliasOf: aliasOf.map(a => ({ url: a.url, name: publicMintName(a.name, a.url).name })),
      })
    })
    .catch((err: unknown) => {
      if (IS_DEV) console.error('[/api/mint/submit]', err)
      res.status(500).json({ error: 'Internal server error' })
    })
})

export const MAX_DISCOVER_BATCH = 100

router.post('/api/mints/discover', async (req: Request, res: Response): Promise<void> => {
  if (isAllowlistMode()) {
    res.status(403).json({ error: 'This deployment monitors a fixed mint allowlist.' })
    return
  }
  const ip = rateLimitKey(req.ip ?? req.socket.remoteAddress)
  const body = req.body as { urls?: unknown; source?: unknown }
  // Default to 'auto' — the smaller budget — when the field is missing or
  // unrecognized, so an unspecified/older caller can't silently claim the
  // larger 'bulk' budget meant for an explicit user action.
  const source: DiscoverSource = body.source === 'bulk' ? 'bulk' : 'auto'

  if (!checkDiscoverRateLimit(ip, source)) {
    const resetAt = discoverRateLimitStoreFor(source).get(ip)?.resetAt
    if (resetAt !== undefined) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))))
    }
    res.status(429).json({ error: 'Too many requests. Try again later.' })
    return
  }

  if (!Array.isArray(body.urls)) {
    res.status(400).json({ error: 'urls must be array' })
    return
  }

  if (body.urls.length > MAX_DISCOVER_BATCH) {
    res.status(400).json({ error: `urls exceeds maximum batch size of ${MAX_DISCOVER_BATCH}` })
    return
  }

  let added = 0
  const results: Array<{ url: string; success: boolean; isNew: boolean; error?: string; errorKind?: ProbeErrorKind; aliasOf?: { url: string; name: string | null }[] }> = []
  for (const url of body.urls) {
    if (typeof url !== 'string') continue
    if (url.length > MAX_URL_LENGTH) {
      results.push({ url, success: false, isNew: false, error: `url exceeds maximum length of ${MAX_URL_LENGTH} characters` })
      continue
    }
    if (!url.startsWith('https://')) {
      results.push({ url, success: false, isNew: false, error: 'url must start with https://' })
      continue
    }
    const normalized = normalizeUrl(url)
    try {
      if (!(await isSafeUrl(normalized))) {
        results.push({ url: normalized, success: false, isNew: false, error: 'Invalid url' })
        continue
      }
      const admission = await checkMintAdmission(normalized, 'manual')
      if (!admission.ok) {
        results.push({ url: normalized, success: false, isNew: false, error: admission.error })
        continue
      }
      // validateCashuMintProbe() does the same single /v1/info fetch
      // isValidCashuMint() used to do, plus hands back the raw pubkey so it
      // can be persisted on first insert (see mintPubkey.ts) without a
      // second outbound request.
      const { valid, pubkey, errorKind } = await validateCashuMintProbe(normalized)
      if (!valid) {
        results.push({
          url: normalized,
          success: false,
          isNew: false,
          error: 'URL does not appear to be a valid Cashu mint',
          ...(errorKind !== undefined ? { errorKind } : {}),
        })
        continue
      }
      const result = await pool.query(
        `INSERT INTO mints (url, is_known, added_via) VALUES ($1, true, 'manual') ON CONFLICT (url) DO NOTHING`,
        [normalized]
      )
      const isNew = result.rowCount !== null && result.rowCount > 0
      if (isNew) added++

      // Alias hint — see the same rationale in POST /api/mint/submit above.
      // Only meaningful for a genuinely new row.
      let aliasOf: { url: string; name: string | null }[] = []
      if (isNew && pubkey !== null) {
        try {
          await persistMintPubkeyIfChanged(normalized, pubkey)
          aliasOf = await findMintsByPubkey(pubkey, normalized)
        } catch (aliasErr) {
          if (IS_DEV) console.error('[discover] alias lookup/persist failed:', aliasErr)
        }
      }

      results.push({ url: normalized, success: true, isNew, aliasOf: aliasOf.map(a => ({ url: a.url, name: publicMintName(a.name, a.url).name })) })
    } catch {
      results.push({ url: normalized, success: false, isNew: false, error: 'Internal error' })
    }
  }

  if (added > 0) invalidateKnownMints()
  res.json({ added, total: body.urls.length, results })
})
