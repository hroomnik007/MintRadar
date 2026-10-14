// scripts/check-lockfile-libc.mjs: npm 10 drops "libc" from a rewritten lockfile (npm ci then installs the musl
// variants on Linux too). The check flags every Linux -gnu / -musl platform package without a libc field.
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

interface Check { checked: number; missing: string[] }
interface Mod { checkLockfile: (lock: unknown, exempt?: string[]) => Check; packageName: (p: string) => string; NO_LIBC_UPSTREAM: string[] }
const script = resolve(__dirname, '../../scripts/check-lockfile-libc.mjs')
const load = async (): Promise<Mod> => (await import(/* @vite-ignore */ script)) as Mod

const good = { packages: {
  '': { name: 'x' },
  'node_modules/@rolldown/binding-linux-x64-gnu': { version: '1', os: ['linux'], cpu: ['x64'], libc: ['glibc'] },
  'node_modules/@rolldown/binding-linux-x64-musl': { version: '1', os: ['linux'], cpu: ['x64'], libc: ['musl'] },
  'node_modules/@rollup/rollup-linux-x64-gnu': { version: '1', os: ['linux'], cpu: ['x64'] }, // publishes no libc upstream
  'node_modules/@esbuild/linux-x64': { version: '1', os: ['linux'], cpu: ['x64'] }, // no -gnu/-musl in the name
  'node_modules/@rolldown/binding-linux-arm-gnueabihf': { version: '1', os: ['linux'], cpu: ['arm'] }, // ARM ABI variant
  'node_modules/react': { version: '19' },
} }
const stripped = structuredClone(good) as typeof good
for (const e of Object.values(stripped.packages)) delete (e as { libc?: string[] }).libc

describe('checkLockfile', () => {
  it('a correct lockfile passes and counts only the entries that need a libc field', async () => {
    const { checkLockfile } = await load()
    expect(checkLockfile(good)).toEqual({ checked: 2, missing: [] })
  })
  it('a lockfile with stripped libc fields fails and names the entries', async () => {
    const { checkLockfile } = await load()
    expect(checkLockfile(stripped)).toEqual({
      checked: 2,
      missing: ['node_modules/@rolldown/binding-linux-x64-gnu', 'node_modules/@rolldown/binding-linux-x64-musl'],
    })
  })
  it('an empty libc array counts as missing; a nested copy is found by its package name', async () => {
    const { checkLockfile, packageName } = await load()
    expect(packageName('node_modules/a/node_modules/@s/b-linux-x64-gnu')).toBe('@s/b-linux-x64-gnu')
    const lock = { packages: { 'node_modules/a/node_modules/@s/b-linux-x64-gnu': { libc: [] } } }
    expect(checkLockfile(lock).missing).toEqual(['node_modules/a/node_modules/@s/b-linux-x64-gnu'])
  })
  it('the exemption list only holds packages that publish no libc field', async () => {
    const { NO_LIBC_UPSTREAM } = await load()
    expect(NO_LIBC_UPSTREAM).toEqual(['@rollup/rollup-', 'lightningcss-', '@napi-rs/lzma-'])
  })
})

describe('the real lockfiles', () => {
  it('both keep their libc fields', async () => {
    const { checkLockfile } = await load()
    for (const f of ['package-lock.json', 'backend/package-lock.json']) {
      const r = checkLockfile(JSON.parse(readFileSync(resolve(__dirname, '../..', f), 'utf8')))
      expect(r.missing, f).toEqual([])
      expect(r.checked, f).toBeGreaterThan(0)
    }
  })
})

describe('the command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'libc-check-'))
  writeFileSync(join(dir, 'good.json'), JSON.stringify(good))
  writeFileSync(join(dir, 'stripped.json'), JSON.stringify(stripped))
  it('exits 0 for a correct lockfile and prints the count', () => {
    const out = execFileSync('node', [script, join(dir, 'good.json')]).toString()
    expect(out).toContain('2 Linux platform packages checked')
  })
  it('exits 1 for a stripped lockfile and says how to repair it', () => {
    const r = spawnSync('node', [script, join(dir, 'stripped.json')])
    expect(r.status).toBe(1)
    expect(r.stderr.toString()).toContain('2 of 2')
    expect(r.stderr.toString()).toContain('npm 11')
  })
})
