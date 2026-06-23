export interface MintInfo {
  name: string
  pubkey?: string
  version?: string
  description?: string
  description_long?: string
  contact?: Array<{ method: string; info: string }>
  motd?: string
  nuts: Record<string, unknown>
  urls?: string[]
  time?: number
  tos_url?: string
  icon_url?: string
}

export interface MintKeyset {
  id: string
  unit: string
  active: boolean
}

export interface MintStatus {
  url: string
  online: boolean
  latencyMs: number | null
  info: MintInfo | null
  keysets: MintKeyset[] | null
  checkedAt: Date
  error?: string
}

const MAX_URL_LENGTH = 500

function validateUrl(url: string): void {
  if (url.length > MAX_URL_LENGTH) {
    throw new TypeError(`URL exceeds maximum length of ${MAX_URL_LENGTH} characters`)
  }
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    throw new TypeError('URL must start with https:// or http://')
  }
}

function mergeSignals(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(10000)
  if (!signal) return timeout
  return AbortSignal.any([signal, timeout])
}

export async function fetchMintInfo(url: string, signal?: AbortSignal): Promise<MintInfo> {
  validateUrl(url)
  const response = await fetch(`${url}/v1/info`, {
    signal: mergeSignals(signal),
    credentials: 'omit',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const data: unknown = await response.json()
  if (typeof data !== 'object' || data === null || !('nuts' in data)) {
    throw new TypeError('Invalid mint info response: missing required "nuts" field')
  }
  return data as MintInfo
}

export async function fetchMintKeysets(url: string, signal?: AbortSignal): Promise<MintKeyset[]> {
  validateUrl(url)
  const response = await fetch(`${url}/v1/keysets`, {
    signal: mergeSignals(signal),
    credentials: 'omit',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const data: unknown = await response.json()
  if (
    typeof data !== 'object' ||
    data === null ||
    !('keysets' in data) ||
    !Array.isArray((data as { keysets: unknown }).keysets)
  ) {
    throw new TypeError('Invalid keysets response: expected array')
  }
  return (data as { keysets: MintKeyset[] }).keysets
}

async function probeMintViaProxy(url: string, signal?: AbortSignal): Promise<MintStatus> {
  const probeUrl = `/api/mint/probe?url=${encodeURIComponent(url)}`
  const timeout = AbortSignal.timeout(15000)
  const fetchSignal = signal !== undefined ? AbortSignal.any([signal, timeout]) : timeout

  try {
    const response = await fetch(probeUrl, { signal: fetchSignal, credentials: 'omit' })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const data: unknown = await response.json()
    if (typeof data !== 'object' || data === null) {
      throw new TypeError('Invalid proxy response')
    }
    const raw = data as Record<string, unknown>
    return {
      url: typeof raw['url'] === 'string' ? raw['url'] : url,
      online: raw['online'] === true,
      latencyMs: typeof raw['latencyMs'] === 'number' ? raw['latencyMs'] : null,
      info: (raw['info'] as MintInfo | null) ?? null,
      keysets: (raw['keysets'] as MintKeyset[] | null) ?? null,
      checkedAt: typeof raw['checkedAt'] === 'string' ? new Date(raw['checkedAt']) : new Date(),
      ...(typeof raw['error'] === 'string' ? { error: raw['error'] } : {}),
    }
  } catch {
    return { url, online: false, latencyMs: null, info: null, keysets: null, checkedAt: new Date(), error: 'Mint unreachable' }
  }
}

export async function probeMint(url: string, signal?: AbortSignal): Promise<MintStatus> {
  const normalizedUrl = url.replace(/\/$/, '')

  if (normalizedUrl.length > MAX_URL_LENGTH) {
    return { url: normalizedUrl, online: false, latencyMs: null, info: null, keysets: null, checkedAt: new Date(), error: 'URL too long' }
  }
  if (!normalizedUrl.startsWith('https://') && !normalizedUrl.startsWith('http://')) {
    return { url: normalizedUrl, online: false, latencyMs: null, info: null, keysets: null, checkedAt: new Date(), error: 'Invalid URL scheme' }
  }

  if (typeof window !== 'undefined') {
    return probeMintViaProxy(normalizedUrl, signal)
  }

  const start = Date.now()
  const [infoResult, keysetsResult] = await Promise.allSettled([
    fetchMintInfo(normalizedUrl, signal),
    fetchMintKeysets(normalizedUrl, signal),
  ])
  const latencyMs = Date.now() - start

  const online = infoResult.status === 'fulfilled'
  const info = infoResult.status === 'fulfilled' ? infoResult.value : null
  const keysets = keysetsResult.status === 'fulfilled' ? keysetsResult.value : null

  const status: MintStatus = {
    url: normalizedUrl,
    online,
    latencyMs: online ? latencyMs : null,
    info,
    keysets,
    checkedAt: new Date(),
  }

  if (infoResult.status === 'rejected') {
    status.error = 'Mint unreachable'
  }

  return status
}
