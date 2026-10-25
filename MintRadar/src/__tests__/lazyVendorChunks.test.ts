// @vitest-environment node
// Guards the Stage 2 lazy-loading rule (src/core/nostr/lazy.ts): the code that runs on first paint must not
// statically import nostr-tools (except its nip19 entry), Dexie, the Nostr client, the relay pool or the db module,
// or those vendor chunks are modulepreloaded on every page again. Walks the static import graph from main.tsx;
// dynamic import() (lazy routes, the loaders) ends a branch, as it does in the bundle.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname, '..')
const ALIASES: [string, string][] = [['@core/', join(SRC, 'core')], ['@/', SRC]]

function resolveLocal(spec: string, from: string): string | null {
  let base: string | null = null
  for (const [prefix, dir] of ALIASES) if (spec.startsWith(prefix)) { base = join(dir, spec.slice(prefix.length)); break }
  if (!base && spec.startsWith('.')) base = resolve(dirname(from), spec)
  if (!base) return null
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (/\.(tsx?)$/.test(c) && existsSync(c)) return c
  }
  return null
}

function staticImports(code: string): string[] {
  const specs: string[] = []
  const fromRe = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]([^'"]+)['"]/g
  for (const m of code.matchAll(fromRe)) {
    const [, typeOnly, clause = '', spec = ''] = m
    if (typeOnly) continue
    const braces = /^\{([\s\S]*)\}$/.exec(clause.trim())
    if (braces && (braces[1] ?? '').split(',').map(s => s.trim()).filter(Boolean).every(s => s.startsWith('type '))) continue
    specs.push(spec)
  }
  for (const m of code.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) if (m[1]) specs.push(m[1])
  return specs
}

function eagerGraph(): { files: Set<string>; packages: Map<string, string> } {
  const files = new Set<string>()
  const packages = new Map<string, string>()
  const queue = [join(SRC, 'main.tsx')]
  while (queue.length) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)
    for (const spec of staticImports(readFileSync(file, 'utf8'))) {
      if (/\.(css|svg|png|json)(\?.*)?$/.test(spec) || spec.startsWith('virtual:')) continue
      const local = resolveLocal(spec, file)
      if (local) queue.push(local)
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.set(spec, relative(SRC, file))
    }
  }
  return { files, packages }
}

describe('initial bundle stays free of the Nostr and Dexie vendor chunks', () => {
  const { files, packages } = eagerGraph()

  it('walks the real app (sanity)', () => {
    const rel = [...files].map(f => relative(SRC, f))
    expect(rel).toContain('App.tsx')
    expect(rel).toContain('components/layout/AppShell.tsx')
    expect(rel).toContain('pages/Dashboard.tsx')
    expect(rel).toContain('core/nostr/lazy.ts')
  })

  it('no eager static import of nostr-tools (except nostr-tools/nip19) or Dexie', () => {
    const bad = [...packages].filter(([p]) =>
      (p === 'nostr-tools' || (p.startsWith('nostr-tools/') && p !== 'nostr-tools/nip19')) ||
      p === 'dexie' || p === 'dexie-react-hooks' || p.startsWith('@noble/') && !p.startsWith('@noble/hashes/utils'))
    expect(bad).toEqual([])
  })

  it('no eager static import of the Nostr client, the relay pool or the db module', () => {
    const forbidden = ['core/nostr/client.ts', 'core/nostr/pool.ts', 'db.ts', 'db/index.ts']
    expect([...files].map(f => relative(SRC, f)).filter(f => forbidden.includes(f))).toEqual([])
  })

  it('the walker sees through a value import but not a type-only one', () => {
    expect(staticImports("import type { A } from 'x'\nimport { type B } from 'y'\nimport { c, type D } from 'z'\nimport 'w'"))
      .toEqual(['z', 'w'])
  })
})
