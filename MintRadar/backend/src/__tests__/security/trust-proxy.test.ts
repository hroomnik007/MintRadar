import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Guard for `app.set('trust proxy', 1)` in index.ts. Reads the source as text (no server, no mocks).
const WHY =
  'index.ts must set `trust proxy` exactly once, to a number literal (a hop count). ' +
  'A subnet string such as "10.0.0.0/8" makes Express compile a trust subnet in proxy-addr; ' +
  'before 2.0.8 a short IPv4-mapped IPv6 prefix matched every client (GHSA-jqcg-44mw-7w3h), so req.ip ' +
  'would be whatever X-Forwarded-For says and the per-IP rate limits (which key on req.ip) could be bypassed. ' +
  'The same goes for `true`, `enable(...)` or a function. See the comment above the setting.'

// Line comments go first: a `//` comment may contain "/*" (e.g. "/api/v1/*") and must not open a block comment.
function codeOnly(): string {
  const src = readFileSync(fileURLToPath(new URL('../../index.ts', import.meta.url)), 'utf8')
  return src
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('trust proxy setting', () => {
  it('is set exactly once, to a number literal, and nothing else touches it', () => {
    const code = codeOnly()
    // sanity: the comment stripping must not have swallowed the app setup (the file is ~2000 lines)
    expect(code).toContain('export const app = express()')
    expect(code.split('\n').length).toBeGreaterThan(1000)
    // every mention of the setting name, in any form (set, enable, settings[...], a variable)
    const mentions = code.match(/trust proxy/g) ?? []
    expect(mentions, WHY).toHaveLength(1)
    const calls = [...code.matchAll(/\bapp\.set\(\s*(['"`])trust proxy\1\s*,\s*([^)]*?)\s*\)/g)]
    expect(calls, WHY).toHaveLength(1)
    expect(calls[0]![2], WHY).toMatch(/^\d+$/)
  })
})
