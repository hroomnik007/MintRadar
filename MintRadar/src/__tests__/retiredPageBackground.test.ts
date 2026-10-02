// The page background was darkened to #0b1512 (--bg). Several plain files embed the token
// (theme-color, manifest, favicon/OG SVGs, icon generator), so a leftover previous value means a mismatch with --bg.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
// Built from parts so this file does not contain the literal it searches for.
const RETIRED_BG = ['10', '20', '1c'].join('')
const RETIRED_RGB = /rgba?\(\s*16\s*,\s*32\s*,\s*28\b/i
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt'])
// No allowlist is needed: docs/ (where history is described) is deliberately outside the scanned set.
const SCANNED = ['src', 'public', 'scripts', 'index.html']

function* files(p: string): Generator<string> {
  const abs = path.join(ROOT, p)
  if (fs.statSync(abs).isDirectory()) {
    for (const e of fs.readdirSync(abs)) yield* files(path.join(p, e))
  } else if (TEXT_EXT.has(path.extname(p))) {
    yield p
  }
}

describe('retired page background', () => {
  it('no text file in src, public, scripts or index.html still contains the old --bg value', () => {
    const offenders: string[] = []
    for (const root of SCANNED) {
      for (const f of files(root)) {
        const text = fs.readFileSync(path.join(ROOT, f), 'utf8')
        if (text.toLowerCase().includes(RETIRED_BG) || RETIRED_RGB.test(text)) offenders.push(f)
      }
    }
    expect(offenders).toEqual([])
  })
})
