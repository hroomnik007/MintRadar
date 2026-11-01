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

function run(lines: string[], env: Record<string, string> = {}): string[] {
  const r = spawnSync('sh', [script], { input: lines.join('\n') + '\n', env: { ...process.env, RATE_DIR: rateDir, ...env }, encoding: 'utf8' })
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

  it('counts an IPv6 client by its /64, so rotating the rest of the address does not help', () => {
    const lines = Array.from({ length: 6 }, (_, i) => ev('dddd', 38000, `2001:db8:1:2:${i}:aaaa:bbbb:cccc`))
    expect(run(lines, { OPEN_PER_IP_HOURLY: '3' })).toEqual(['accept', 'accept', 'accept', 'reject', 'reject', 'reject'])
  })

  it('counts different spellings of one IPv6 /64 as one client (compressed, upper case, leading zeros)', () => {
    const lines = ['2001:db8:0:0:1:2:3:4', '2001:DB8::1:2:3:5', '2001:0db8::9', '2001:db8::', '2001:db8:0:1::7']
      .map(ip => ev('hhhh', 38000, ip))
    // the first four share the prefix 2001:db8:0:0, the last one is another /64
    expect(run(lines, { OPEN_PER_IP_HOURLY: '2' })).toEqual(['accept', 'accept', 'reject', 'reject', 'accept'])
  })

  it('a heavy source cannot use up the room of occasional writers (two-tier global limit)', () => {
    const env = { OPEN_PER_IP_HOURLY: '100', OPEN_LIGHT_SOURCE_EVENTS: '2', OPEN_GLOBAL_HOURLY: '8', OPEN_GLOBAL_HARD_HOURLY: '12' }
    const heavy = Array.from({ length: 12 }, () => ev('eeee', 38000, '5.5.5.5'))
    const out = run([...heavy, ev('ffff', 38000, '6.6.6.6'), ev('ffff', 38000, '7.7.7.7')], env)
    expect(out.slice(0, 8).every(a => a === 'accept')).toBe(true) // up to the soft total
    expect(out.slice(8, 12).every(a => a === 'reject')).toBe(true) // the heavy source is stopped at the soft total
    expect(out.slice(12)).toEqual(['accept', 'accept']) // new sources still get in, up to the hard ceiling
  })

  it('stops everyone at the hard ceiling', () => {
    const env = { OPEN_GLOBAL_HOURLY: '2', OPEN_GLOBAL_HARD_HOURLY: '3', OPEN_LIGHT_SOURCE_EVENTS: '5' }
    const out = run([1, 2, 3, 4, 5].map(i => ev('gggg', 38000, `9.9.9.${i}`)), env)
    expect(out).toEqual(['accept', 'accept', 'accept', 'reject', 'reject'])
  })

  it('treats a hostile client address as data, not a path', () => {
    expect(run([ev('aaaa', 38000, '../../etc/x')])).toEqual(['accept'])
  })
})
