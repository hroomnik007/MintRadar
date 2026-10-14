import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

// The app has ONE tooltip: components/InfoTooltip.tsx (+ utils/tooltipManager.ts, utils/tooltipPosition.ts).
// These tests scan the source so that the patterns it replaced cannot come back, and so that every use of the
// component is nameable by a screen reader.

const SRC = resolve(__dirname, '..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : walk(p)
    return /\.(tsx?|css)$/.test(name) ? [p] : []
  })
}
const FILES = walk(SRC)
const read = (p: string) => readFileSync(p, 'utf8')
const rel = (p: string) => relative(SRC, p).replace(/\\/g, '/')

describe('the old tooltip implementations are gone', () => {
  const REMOVED: [string, RegExp][] = [
    ['the useTapTooltip hook', /useTapTooltip/],
    ['the .audit-tooltip box (and .audit-tooltip-down)', /audit-tooltip/],
    ['the hand-rolled hover/tap handlers of a tooltip trigger (tooltip.onPointerEnter / onClick)', /[tT]ooltip\.(onPointerEnter|onPointerLeave|onClick)\b/],
    ['a hand-built tooltip box (inline style with a 20 px shadow and pointerEvents none)', /boxShadow:\s*'0 4px 20px rgba\(0,\s*0,\s*0,\s*0\.5\)'[^}]*pointerEvents:\s*'none'|pointerEvents:\s*'none'[^}]*boxShadow:\s*'0 4px 20px/],
  ]
  for (const [what, re] of REMOVED) {
    it(`no source file brings back ${what}`, () => {
      const hits = FILES.filter(f => re.test(read(f))).map(rel)
      expect(hits).toEqual([])
    })
  }

  it('the tooltip box class lives only in InfoTooltip (css + tsx)', () => {
    const hits = FILES.filter(f => /info-tooltip-pop/.test(read(f))).map(rel).sort()
    expect(hits).toEqual(['components/InfoTooltip.css', 'components/InfoTooltip.tsx'])
  })

  it('the old hook file does not exist', () => {
    expect(FILES.map(rel)).not.toContain('hooks/useTapTooltip.ts')
  })
})

/** Every `<InfoTooltip ...>` element of the source: its opening tag text and whether it has children. */
function infoTooltipElements(): { file: string; tag: string; hasChildren: boolean }[] {
  const out: { file: string; tag: string; hasChildren: boolean }[] = []
  for (const f of FILES.filter(p => p.endsWith('.tsx'))) {
    const s = read(f)
    for (let at = s.indexOf('<InfoTooltip'); at !== -1; at = s.indexOf('<InfoTooltip', at + 1)) {
      // scan to the end of the opening tag: the first `>` that is outside {braces} and quotes
      let i = at + '<InfoTooltip'.length, depth = 0, quote = ''
      for (; i < s.length; i++) {
        const c = s[i]!
        if (quote) { if (c === quote && s[i - 1] !== '\\') quote = ''; continue }
        if (c === '"' || c === "'" || (c === '`' && depth > 0)) { quote = c; continue }
        if (c === '{') depth++
        else if (c === '}') depth--
        else if (c === '>' && depth === 0) break
      }
      const tag = s.slice(at, i + 1)
      out.push({ file: rel(f), tag, hasChildren: !tag.endsWith('/>') })
    }
  }
  return out
}

describe('every use of InfoTooltip has an accessible name', () => {
  const uses = infoTooltipElements().filter(u => u.file !== 'components/InfoTooltip.tsx')

  it('finds the migrated call sites', () => {
    expect(uses.length).toBeGreaterThan(30)
  })

  it('passes a label, an `about` (the visible label it sits next to) or chip children', () => {
    const bad = uses.filter(u => !u.hasChildren && !/\b(label|about)=/.test(u.tag)).map(u => `${u.file}: ${u.tag.replace(/\s+/g, ' ').slice(0, 90)}`)
    expect(bad).toEqual([])
  })

  it('never passes an empty label or about', () => {
    const bad = uses.filter(u => /\b(label|about)=(""|\{""\}|\{''\})/.test(u.tag)).map(u => u.file)
    expect(bad).toEqual([])
  })

  it('always passes the text', () => {
    const bad = uses.filter(u => !/\btext=/.test(u.tag)).map(u => u.file)
    expect(bad).toEqual([])
  })
})

describe('title attributes are not used for explanations', () => {
  // A native title does nothing on touch and nothing for keyboard users. Explanations go through InfoTooltip.
  // The titles that remain are listed here, each with the reason it stays a title; a new one fails this test.
  // [file, regexp matching the line, why]
  const ALLOWED: [string, RegExp, string][] = [
    ['components/layout/AppShell.tsx', /title="(MintRadar|Copy pairing link)"/, 'label of a logo link / an icon-only copy button'],
    ['components/layout/AccountMenu.tsx', /title=\{profile\.name \?\? undefined\}|title="Copy full npub"/, 'repeats the visible name / labels a copy button'],
    ['components/ComparisonModal.tsx', /title=\{mint\.version \?\? undefined\}/, 'the full version string behind an ellipsis'],
    ['components/mint/MintCard.tsx', /title=\{(mint\.nameFull \?\? displayName|isOnline \? 'Online' : 'Offline'|hostname|`Compare \$\{displayName\}`|starLabel)\}/, 'repeats the visible name / labels an icon-only button or a status dot'],
    ['components/AuditCzCards.tsx', /title=\{|title: AUDIT_CZ|\{ title: auditCzStateTitle/, 'table row of a grey (not counted) swap and SwapTable props; the State cell itself is an InfoTooltip'],
    ['pages/Watchlist.tsx', /title=\{getDisplayName\(pk\)\}/, 'the name of an avatar'],
    // `title` here is a prop of our own components (a page heading, a table caption, a code block), not an HTML attribute.
    ['components/AuditCzCards.tsx', /<SwapTable title=/, 'SwapTable prop'],
    ['pages/ForWallets.tsx', /title="Error body"/, 'CodeBlock prop (continued line)'],
    ['pages/Learn.tsx', /title="Learn"/, 'PageHead prop (continued line)'],
    ['pages/Stats.tsx', /title="Network stats"/, 'PageHead prop (continued line)'],
    ['pages/Tools.tsx', /title="Tools"/, 'PageHead prop (continued line)'],
    ['pages/Wallets.tsx', /title="Wallets"/, 'PageHead prop (continued line)'],
    ['pages/NutExplorer.tsx', /title=\{url\}/, 'the full URL behind an ellipsis'],
    ['pages/Stats.tsx', /title="CDN \/ anycast addresses are not a city"/, 'the host is a clickable row; a button inside it would nest controls'],
    ['pages/Tools.tsx', /title="Opens the Cashu redeem page/, 'the host is a link; a button inside it would nest controls'],
    ['pages/Dashboard.tsx', /title=\{(displayName|getHostname\(mint\.url\)|lookupResult\.url|p\.url|HIDE_TEST_MINTS_TOOLTIP)\}|title="(Card view|List view|Reset filters & refresh)"/, 'repeats visible text / labels an icon-only button; the Hide test mints label is a label + checkbox (a button inside it is invalid)'],
    ['pages/MintDetail.tsx', /title="(Copy full keyset ID|Copy full public key|Copy URL|Copy|Copy reviewer npub|Open this review on Nostr|Copy link to this review|Mint clock vs this browser|Last swaps, newest first)"|title=\{(isWatching|resolvedNameFull|`Add|`Remove|trackedIsOnion|s\.neutral|AUDIT_CZ_NEUTRAL_TITLE|\.\.\.\(operatorListedCount|\{\.\.\.\(operatorListedCount)|\{ title: (resolvedNameFull|AUDIT_CZ_NEUTRAL_TITLE)|title: `Counts every listed review/, 'labels of icon-only buttons; the Tor chip sits inside the copy-URL button; the swap bar marks are chart-like hover values; table rows and the review filter group cannot hold a button'],
  ]

  const TITLE_LINE = /\btitle\s*[=:]\s*[{"'`]/
  it('every remaining title attribute is on the allow-list', () => {
    const offenders: string[] = []
    for (const f of FILES.filter(p => p.endsWith('.tsx'))) {
      const file = rel(f)
      read(f).split('\n').forEach((line, n) => {
        if (!TITLE_LINE.test(line)) return
        // props of our own components, document titles and SVG <title> are not tooltips
        if (/<(PageHead|CodeBlock|Modal)\b|\b(srTitle|modalTitle|useDocumentMeta)\b|<title>|title: '(Nostr|Remote|Connect)|\bmod\.title\b|\be\.title\b|\bm\.title\b|\.title\}/.test(line)) return
        if (/^\s*(title|subtitle):/.test(line) && file === 'components/layout/AppShell.tsx') return
        const allowed = ALLOWED.some(([f2, re]) => f2 === file && re.test(line))
        if (!allowed) offenders.push(`${file}:${n + 1}: ${line.trim().slice(0, 120)}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
