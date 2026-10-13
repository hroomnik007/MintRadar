// docs/examples/verify-health.mjs IS the code shown on /for-wallets (constants/verifyHealthSnippet.ts): one source.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { VERIFY_HEALTH_SNIPPET, VERIFY_HEALTH_FILE_NAME, VERIFY_HEALTH_RUNTIME_SENTENCE } from '@/constants/verifyHealthSnippet'

const FILE = resolve(__dirname, '../../docs/examples/verify-health.mjs')
if (process.env['UPDATE_VERIFY_HEALTH_EXAMPLE'] === '1') writeFileSync(FILE, VERIFY_HEALTH_SNIPPET)

describe('docs/examples/verify-health.mjs', () => {
  it('equals the snippet shown on the page, byte for byte (rewrite it with UPDATE_VERIFY_HEALTH_EXAMPLE=1)', () => {
    expect(readFileSync(FILE, 'utf8')).toBe(VERIFY_HEALTH_SNIPPET)
  })
  it('starts with the one runtime sentence and has the file name the page uses', () => {
    expect(VERIFY_HEALTH_SNIPPET.split('\n')[0]).toBe(`// ${VERIFY_HEALTH_RUNTIME_SENTENCE}`)
    expect(VERIFY_HEALTH_RUNTIME_SENTENCE).toBe('Runs in browsers and in Node 22 or newer; on older Node pass the ws package\'s WebSocket class as the webSocket option.')
    expect(FILE.endsWith(VERIFY_HEALTH_FILE_NAME)).toBe(true)
  })
})
