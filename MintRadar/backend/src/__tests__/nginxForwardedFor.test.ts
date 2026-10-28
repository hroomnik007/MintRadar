import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Express runs with `trust proxy` = 1, so req.ip comes from X-Forwarded-For. A proxied nginx location that does not
// overwrite it forwards the client's own header and every per-IP rate limiter then keys on a spoofable value.
// A location with its own proxy_set_header inherits nothing from the server level, so each one must set it itself.

const conf = readFileSync(fileURLToPath(new URL('../../../deploy/nginx.conf', import.meta.url)), 'utf8')

// Top-level `location ... { ... }` blocks of the server (the config has no nested braces inside a location).
function locationBlocks(text: string): { head: string; body: string }[] {
  const out: { head: string; body: string }[] = []
  const re = /^\s*(location\s+[^{]+?)\s*\{([^}]*)\}/gm
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ head: m[1], body: m[2] })
  return out
}

describe('deploy/nginx.conf — X-Forwarded-For', () => {
  const proxied = locationBlocks(conf).filter(l => /proxy_pass\s+http:\/\/127\.0\.0\.1:3002/.test(l.body))

  it('finds the proxied backend locations', () => {
    const heads = proxied.map(l => l.head)
    expect(heads).toEqual(expect.arrayContaining(['location /api/', 'location = /health', 'location = /sitemap.xml', 'location @spa_html']))
  })

  it.each(proxied.map(l => [l.head, l.body] as const))('%s overwrites X-Forwarded-For with $remote_addr', (_head, body) => {
    expect(body).toMatch(/proxy_set_header\s+X-Forwarded-For\s+\$remote_addr\s*;/)
  })

  it('/health is an exact match, so /healthz is not proxied with the raw path', () => {
    expect(proxied.some(l => l.head === 'location /health')).toBe(false)
  })
})
