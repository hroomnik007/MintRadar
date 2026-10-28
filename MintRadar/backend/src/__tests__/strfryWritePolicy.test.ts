import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// deploy/strfry/writePolicy.sh: privileged keys write anything; everyone else only kinds 38172/38000, and those are
// bounded per event, per client IP and in total per hour, so a stranger cannot fill the relay's 1 GiB database.

const script = fileURLToPath(new URL('../../../deploy/strfry/writePolicy.sh', import.meta.url))
const privileged = readFileSync(fileURLToPath(new URL('../../../deploy/strfry/privileged-pubkeys.txt', import.meta.url)), 'utf8')
  .split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))[0] as string
const hasJq = spawnSync('jq', ['--version']).status === 0

let rateDir: string
beforeEach(() => { rateDir = mkdtempSync(join(tmpdir(), 'wp-')) })
afterEach(() => { rmSync(rateDir, { recursive: true, force: true }) })

let n = 0
const ev = (pubkey: string, kind: number, ip = '1.1.1.1', content = 'x') =>
  JSON.stringify({ type: 'new', event: { id: `e${n++}`, pubkey, kind, content, tags: [] }, sourceType: 'IP4', sourceInfo: ip })

function run(lines: string[]): string[] {
  const r = spawnSync('sh', [script], { input: lines.join('\n') + '\n', env: { ...process.env, RATE_DIR: rateDir }, encoding: 'utf8' })
  return r.stdout.trim().split('\n').map(l => (JSON.parse(l) as { action: string }).action)
}

describe.skipIf(!hasJq)('deploy/strfry/writePolicy.sh', { timeout: 30_000 }, () => {
  it('accepts the two open kinds and rejects other kinds from strangers', () => {
    expect(run([ev('aaaa', 38000), ev('aaaa', 38172), ev('aaaa', 1)])).toEqual(['accept', 'accept', 'reject'])
  })

  it('always accepts a privileged key, any kind', () => {
    expect(run([ev(privileged, 1), ev(privileged, 30385)])).toEqual(['accept', 'accept'])
  })

  it('rejects an oversized open event', () => {
    expect(run([ev('aaaa', 38000, '1.1.1.1', 'y'.repeat(20000))])).toEqual(['reject'])
  })

  it('limits one IP per hour but not another IP or a privileged key', () => {
    const flood = Array.from({ length: 125 }, () => ev('bbbb', 38172, '2.2.2.2'))
    const out = run([...flood, ev('cccc', 38172, '3.3.3.3'), ev(privileged, 1, '2.2.2.2')])
    expect(out.slice(0, 120).every(a => a === 'accept')).toBe(true)
    expect(out.slice(120, 125).every(a => a === 'reject')).toBe(true)
    expect(out.slice(125)).toEqual(['accept', 'accept'])
  })

  it('treats a hostile client address as data, not a path', () => {
    expect(run([ev('aaaa', 38000, '../../etc/x')])).toEqual(['accept'])
  })
})
