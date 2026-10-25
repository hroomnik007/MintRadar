// public/llms.txt is served as-is at https://mintradar.org/llms.txt. It may only say what the code already says:
// every link and the Nostr kind and relay are compared with the constants they come from, and every path it names
// has to exist (a route of the router, the sitemap, the OpenAPI file, a file of the repository).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { WALLET_API_BASE, WALLET_API_FACTS } from '@/constants/forWalletsPage'
import { REPO_BLOB_URL } from '@/constants/contact'
import { ATTESTATION_RELAYS_PUBLIC } from '@/utils/healthAssertionConstants'
import { METHODOLOGY_PAGE } from '@/constants/methodologyPage'
import { OPENAPI_PUBLIC_PATH, OPENAPI_SOURCE } from '../../vite-openapi'

const ROOT = process.cwd()
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const txt = read('public/llms.txt')
const SITE = 'https://mintradar.org'
const HEALTH_KIND = /export const HEALTH_KIND = (\d+)/.exec(read('backend/src/healthAssertions.ts'))?.[1]
const urls = (txt.match(/(?:https?|wss):\/\/[^\s)>\],]+/g) ?? []).map(u => u.replace(/[.:;]+$/, ''))

describe('public/llms.txt', () => {
  it('exists, is short Markdown with the title and no HTML', () => {
    expect(txt.startsWith('# MintRadar\n')).toBe(true)
    expect(txt.split('\n').length).toBeLessThanOrEqual(20)
    expect(txt).not.toMatch(/<[a-z!][^>]*>/i)
  })

  it('names every link of the brief', () => {
    for (const link of [
      `${SITE}/for-wallets`,
      `${WALLET_API_BASE}/wallets/`,
      `${SITE}${OPENAPI_PUBLIC_PATH}`,
      `${SITE}/methodology`,
      `${SITE}/sitemap.xml`,
      `${REPO_BLOB_URL}/docs/nostr-health-assertions.md`,
    ]) expect(txt, link).toContain(link)
  })

  it('names the health-record kind and relay from the code constants', () => {
    expect(HEALTH_KIND).toBe('30385')
    expect(txt).toContain(`kind ${HEALTH_KIND}`)
    expect(txt).toContain(ATTESTATION_RELAYS_PUBLIC[0])
  })

  it('says the probe interval of the code and the disclaimer of the OpenAPI file', () => {
    expect(txt).toContain(`every ${METHODOLOGY_PAGE.cadence.probeMinutes} minutes`)
    expect(WALLET_API_FACTS.pollMinutes).toBe(METHODOLOGY_PAGE.cadence.probeMinutes)
    expect(read(OPENAPI_SOURCE)).toContain('Operational health signal, not solvency')
    expect(txt).toMatch(/operational health signal/i)
    expect(txt).toMatch(/not a statement about solvency or custody/)
  })

  it('has no http:// link and no host except mintradar.org, github.com and the relay', () => {
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) {
      expect(u.startsWith('http://'), u).toBe(false)
      const host = new URL(u).hostname
      expect(['mintradar.org', 'nostr.mintradar.org', 'github.com'], u).toContain(host)
    }
    expect(txt).not.toMatch(/(^|[^/\w.])www\./)
  })

  it('names no path that does not exist', () => {
    const app = read('src/App.tsx')
    const routes = new Set(['/', ...[...app.matchAll(/path: '([^'*]+)'/g)].map(m => `/${m[1]}`)])
    const known = new Set([...routes, '/sitemap.xml', OPENAPI_PUBLIC_PATH])
    expect(routes.has('/for-wallets') && routes.has('/methodology')).toBe(true)
    expect(fs.existsSync(path.join(ROOT, OPENAPI_SOURCE))).toBe(true)
    for (const u of urls) {
      const url = new URL(u)
      if (url.protocol === 'wss:') continue
      if (u === `${WALLET_API_BASE}/wallets/`) {
        // the API base: the OpenAPI file documents /wallets/mints under it
        expect(read(OPENAPI_SOURCE), u).toContain('  /wallets/mints:')
        continue
      }
      if (url.hostname === 'github.com') {
        expect(u.startsWith(`${REPO_BLOB_URL}/`), u).toBe(true)
        const file = u.slice(REPO_BLOB_URL.length + 1)
        expect(fs.existsSync(path.join(ROOT, file)), `${file} in the repository`).toBe(true)
        continue
      }
      if (url.hostname === 'mintradar.org') expect(known.has(url.pathname), u).toBe(true)
    }
  })
})

// There is no parser test for deploy/nginx.conf in this repository; these checks only pin the Task D1b blocks.
describe('deploy/nginx.conf, Task D1b blocks', () => {
  const conf = read('deploy/nginx.conf')
  const block = (loc: string) => {
    const i = conf.indexOf(`location = ${loc} {`)
    expect(i, loc).toBeGreaterThan(-1)
    return conf.slice(i, conf.indexOf('\n    }', i))
  }

  it('maps yaml to application/yaml in the types block', () => {
    expect(conf).toMatch(/types \{[^}]*application\/yaml yaml;[^}]*\}/)
  })

  it('serves the OpenAPI file and llms.txt as real files with CORS and the security headers', () => {
    for (const loc of [OPENAPI_PUBLIC_PATH, '/llms.txt']) {
      const b = block(loc)
      expect(b, loc).toContain('try_files $uri =404;')
      expect(b, loc).toContain('add_header Access-Control-Allow-Origin * always;')
      for (const h of ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Strict-Transport-Security', 'Content-Security-Policy']) {
        expect(b, `${loc} ${h}`).toContain(`add_header ${h} `)
      }
    }
    expect(block('/llms.txt')).toContain('default_type text/plain;')
    expect(block('/llms.txt')).toContain('charset utf-8;')
  })

  it('answers the AI catalog path with a real 404 and leaves location / alone', () => {
    expect(block('/.well-known/ai-catalog.json')).toContain('return 404;')
    expect(conf).toContain('    location / {\n        try_files $uri $uri/ /index.html;\n    }')
  })
})

// Task E3: the prefix location must win over the static-asset regex location, otherwise a mint URL that ends in an
// asset extension (/mint/https%3A%2F%2Fexample.com%2Ficon.svg) gets a bare nginx 404 instead of the app shell.
describe('deploy/nginx.conf, Task E3 /mint/ precedence', () => {
  const conf = read('deploy/nginx.conf')

  it('declares /mint/ once, as a ^~ prefix location', () => {
    expect(conf).toMatch(/^ {4}location \^~ \/mint\/ \{$/m)
    expect(conf.match(/location [^\n]*\/mint\/ \{/g)).toHaveLength(1)
  })
})

// Stage 2 perf (2026-10-25): precompressed .gz served by the built-in gzip_static module; no brotli (would need a
// third-party nginx module), and on-the-fly gzip stays for the API.
describe('deploy/nginx.conf, gzip_static', () => {
  const conf = read('deploy/nginx.conf')

  it('enables gzip_static once at server level, keeps gzip on, and has no brotli directive', () => {
    expect(conf.match(/^ {4}gzip_static on;$/gm)).toHaveLength(1)
    expect(conf).toMatch(/^ {4}gzip on;$/m)
    expect(conf).not.toMatch(/^\s*brotli/m)
    expect(conf).not.toMatch(/load_module/)
  })
})

describe('deploy/strfry/docker-compose.strfry.yml, Task E3 healthcheck', () => {
  const compose = read('deploy/strfry/docker-compose.strfry.yml')

  it('checks the NIP-11 answer on 127.0.0.1:7777 with the agreed timings', () => {
    expect(compose).toContain('"--header=Accept: application/nostr+json", "http://127.0.0.1:7777/"]')
    for (const line of ['interval: 30s', 'timeout: 5s', 'retries: 3', 'start_period: 20s']) expect(compose).toContain(`      ${line}\n`)
  })
})
