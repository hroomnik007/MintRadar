// Guards the "semantic colours must be tokens" rule (docs/claude/design-palette-and-chrome.md):
// the neon greens / reds / ambers and the old copper were replaced by var(--accent),
// var(--red), var(--amber) and var(--copper) (+ their -soft / -soft-strong variants).
// This scans every non-test source file and fails if one of the retired literals comes back.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const RETIRED = [
  '#17E87F', '#4ade80', '#00E676', '#E24B4A', '#ff4d4d', '#ffa500', '#f59e0b', '#c98058',
  'rgba(74,222,128,', 'rgba(23,232,127,', 'rgba(255,61,107,',
]

// Explicit allowlist: file (basename) → retired literal → why a real, literal colour is needed.
const ALLOWLIST: Record<string, Record<string, string>> = {
  'ComparisonModal.tsx': {
    '#17E87F': 'MINT_COLORS[0]: categorical A-series identity colour for the Recharts overlay (real value, not a status colour)',
  },
  'MintDetail.tsx': {
    '#17E87F': 'REVIEW_AVATAR_COLORS: categorical avatar-fallback palette (identity, not status)',
  },
}

const SRC = path.resolve(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__' || e.name === 'test') continue
      walk(p, out)
    } else if (/\.(ts|tsx|css)$/.test(e.name) && !/\.(test|spec)\.(ts|tsx)$/.test(e.name)) {
      out.push(p)
    }
  }
  return out
}

// Drop comments so documentation may still mention a retired value by name.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(),])\/\/.*$/gm, '$1')
}

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

describe('retired colour literals', () => {
  const files = walk(SRC)

  it('scans a plausible set of source files', () => {
    expect(files.length).toBeGreaterThan(50)
    expect(files.some(f => f.endsWith('index.css'))).toBe(true)
  })

  it('finds none outside the allowlist', () => {
    const hits: string[] = []
    for (const f of files) {
      const text = norm(stripComments(fs.readFileSync(f, 'utf8')))
      const allowed = ALLOWLIST[path.basename(f)] ?? {}
      for (const lit of RETIRED) {
        if (text.includes(norm(lit)) && !(lit in allowed)) hits.push(`${path.relative(SRC, f)}: ${lit}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('allowlist entries are still needed (no stale exceptions)', () => {
    for (const [base, lits] of Object.entries(ALLOWLIST)) {
      const f = files.find(x => path.basename(x) === base)
      expect(f, `${base} exists`).toBeDefined()
      const text = norm(stripComments(fs.readFileSync(f!, 'utf8')))
      for (const lit of Object.keys(lits)) expect(text.includes(norm(lit)), `${base} still contains ${lit}`).toBe(true)
    }
  })
})
