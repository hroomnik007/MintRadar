// Guards the root README (the one canonical README; MintRadar/README.md is only a pointer):
//  (a) wording the owner ruled out stays out,
//  (b) every number the README keeps equals the code constant (or file) it describes,
//  (c) every relative link of the README, the pointer README and CONTRIBUTING.md resolves.
// A number that is not backed by a constant below must not be added to the README: generalise it or
// link to /methodology instead (see docs/claude/methodology-and-wallet-pages.md).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { METHODOLOGY_PAGE } from '@/constants/methodologyPage'
import { PROBE_LOCATION } from '@/constants/probeLocation'
import { LEARN_MODULES } from '@/constants/learnModules'
import { MAX_COMPARE_MINTS } from '@/utils/compareUrlParam'
import { RATING_PRIOR, RATING_PRIOR_WEIGHT } from '@/utils/bayesianRating'

const ROOT = process.cwd() // the app directory (MintRadar/MintRadar)
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const readme = read('../README.md')
const pkg = JSON.parse(read('package.json')) as { engines: { node: string }; dependencies: Record<string, string>; devDependencies: Record<string, string> }
const backendPkg = JSON.parse(read('backend/package.json')) as { engines: { node: string }; dependencies: Record<string, string> }
const major = (range: string) => /(\d+)/.exec(range)![1]!

// Sentences of the README that name a banned word only to deny it. None today; add the exact sentence here
// (with a comment why) before such a sentence may enter the README.
const DENYING_SENTENCES: string[] = []
const readmeForWords = DENYING_SENTENCES.reduce((text, s) => text.replace(s, ''), readme)

describe('README wording', () => {
  it.each(['Trust Score', 'good first issue'])('does not contain "%s"', phrase => {
    expect(readme.toLowerCase()).not.toContain(phrase.toLowerCase())
  })

  it('does not tell the reader to run "npm install" in a code block', () => {
    const blocks = [...readme.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map(m => m[1]!)
    expect(blocks.length).toBeGreaterThan(0)
    for (const b of blocks) expect(b, 'use "npm ci": npm install rewrites the lockfiles').not.toMatch(/npm install/)
  })

  it('does not say audit.8333.space and cashu.info feed the score together', () => {
    expect(readme).not.toMatch(/audit\.8333\.space and cashu\.info/i)
  })

  it.each(['trusted', 'safe', 'guaranteed'])('does not use the verdict word "%s"', word => {
    expect(readmeForWords).not.toMatch(new RegExp(`\\b${word}\\b`, 'i'))
  })
})

describe('README numbers equal the code', () => {
  it('probe interval', () => {
    expect(readme).toContain(`every **${METHODOLOGY_PAGE.cadence.probeMinutes} minutes**`)
  })

  it('score windows (uptime hours, audit days)', () => {
    expect(readme).toContain(`last ${METHODOLOGY_PAGE.uptime.windowHours} hours`)
    expect(readme).toContain(`last ${METHODOLOGY_PAGE.audit.windowDays} days' swaps`)
  })

  it('probe location', () => {
    expect(readme).toContain(`from ${PROBE_LOCATION}, DE`)
  })

  it('compare limit', () => {
    expect(readme).toContain(`Compare up to **${MAX_COMPARE_MINTS}** mints`)
  })

  it('Rating sort formula', () => {
    expect(readme).toContain(`(n·avg + ${RATING_PRIOR_WEIGHT}·${RATING_PRIOR}) / (n + ${RATING_PRIOR_WEIGHT})`)
  })

  it('number of Learn modules', () => {
    expect(readme).toContain(`A ${LEARN_MODULES.length}-module "Cashu 101" course`)
    expect(fs.readdirSync(path.join(ROOT, 'src/pages/learn')).filter(f => /^Module\d+\.tsx$/.test(f))).toHaveLength(LEARN_MODULES.length)
  })

  it('Node major (engines, backend engines, Dockerfile, workflow)', () => {
    const n = major(pkg.engines.node)
    expect(major(backendPkg.engines.node)).toBe(n)
    expect(readme).toContain(`Node.js ${n} or newer`)
    expect(readme).toContain(`Node.js ${n} + Express`)
    expect(read('backend/Dockerfile')).toContain(`FROM node:${n}`)
    expect(read('../.github/workflows/deploy.yml')).toContain(`node-version: ${n}`)
  })

  it('stack majors (React, Vite, Express) and the PostgreSQL image', () => {
    expect(readme).toContain(`React ${major(pkg.dependencies['react']!)}`)
    expect(readme).toContain(`Vite ${major(pkg.devDependencies['vite']!)}`)
    expect(readme).toContain(`Express ${major(backendPkg.dependencies['express']!)}`)
    expect(read('docker-compose.yml')).toContain(`image: postgres:${/PostgreSQL (\d+)/.exec(readme)![1]}-`)
  })

  it('backend port and dev origin', () => {
    expect(readme).toContain('port 3002')
    expect(read('docker-compose.yml')).toContain('"127.0.0.1:3002:3002"')
    expect(read('vite.config.ts')).toContain('http://localhost:3002')
    expect(readme).toContain('http://localhost:5173')
    expect(read('backend/.env.example')).toContain('http://localhost:5173')
  })

  it('Nostr event kinds and chart periods named in the README', () => {
    expect(read('src/core/nostr/mintDiscovery.ts')).toContain('38172')
    expect(read('src/hooks/useSubmitReview.ts')).toContain('38000')
    expect(read('src/core/nostr/watchlistSync.ts')).toContain('10003')
    expect(read('backend/src/shared/healthAssertionConstants.ts')).toContain('30385')
    for (const k of ['38172', '38000', '10003', '30385']) expect(readme).toContain(`kind:${k}`.replace('kind:30385', 'kind 30385'))
    expect(read('src/pages/MintDetail.tsx')).toContain("'24h' | '7d' | '30d' | '90d'")
    expect(readme).toContain('24 h / 7 d / 30 d / 90 d')
  })
})

describe('README relative links', () => {
  const files: Array<[string, string]> = [
    ['README.md (root)', '../README.md'],
    ['MintRadar/README.md (pointer)', 'README.md'],
    ['.github/CONTRIBUTING.md', '../.github/CONTRIBUTING.md'],
  ]
  it.each(files)('%s: every relative link points to an existing file or folder', (_label, rel) => {
    const abs = path.resolve(ROOT, rel)
    const text = fs.readFileSync(abs, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
    const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g)]
      .map(m => m[1]!)
      .filter(t => !/^(https?:|mailto:|#)/i.test(t))
      .map(t => t.split('#')[0]!)
    expect(targets.length, `no relative links found in ${rel}`).toBeGreaterThan(0)
    for (const t of targets) {
      expect(fs.existsSync(path.resolve(path.dirname(abs), t)), `${rel}: link "${t}" does not exist relative to ${path.dirname(abs)}`).toBe(true)
    }
  })
})
