// The Markdown of the Learn articles on Nostr (kind 30023, scripts/publishLearnModules.ts). Only the pure converter is
// imported: nothing here can sign or publish.
import { describe, it, expect } from 'vitest'
import path from 'path'
import { readFileSync } from 'fs'
import {
  MODULE_META, convertInline, extractBlocks, unconvertedText, parseModuleSource, parseAllModules, findModulesDir,
} from '../scripts/learnModuleMarkdown.js'
import { LEARN_MODULES } from '../shared/learnModules.js'

const MODULES_DIR = path.join(__dirname, '..', '..', '..', 'src', 'pages', 'learn')
const META4 = MODULE_META.find(m => m.order === 4)!

const page = (body: string, title = META4.title) =>
  `export default function M() {\n  return (\n    <div className="learn-content">\n      <h1>${title}</h1>\n${body}\n    </div>\n  )\n}\n`

describe('learn module Markdown: blocks', () => {
  it('turns <h2> section headings into ## and <h3> into ###', () => {
    expect(extractBlocks('<h2>Fees</h2><p>One.</p><h3>Input fee</h3><p>Two.</p>')).toEqual(['## Fees', 'One.', '### Input fee', 'Two.'])
  })

  it('keeps lists, the key takeaway box, a CTA link and a diagram note', () => {
    const blocks = extractBlocks(`
      <ol><li>Open it.</li><li>Paste <code>https://</code>.</li></ol>
      <ul><li><strong>A</strong> first</li><li>B</li></ul>
      <KeyTakeaway><strong>Back up. Always.</strong></KeyTakeaway>
      <Link to="/wallets" className="learn-cta-btn">Browse Cashu wallets →</Link>
      <TokenFlowDiagram />`)
    expect(blocks).toEqual([
      '1. Open it.\n2. Paste `https://`.',
      '- **A** first\n- B',
      '> 🔑 **Key takeaway**\n>\n> **Back up. Always.**',
      '[Browse Cashu wallets →](https://mintradar.org/wallets)',
      '*(interactive diagram — best viewed at mintradar.org/learn)*',
    ])
  })

  it('converts bold, emphasis, links (also bold links and code inside links) and inline code', () => {
    expect(convertInline('<strong><a href="https://minibits.cash" target="_blank" rel="noopener noreferrer">Minibits</a></strong> and <em>only</em>'))
      .toBe('**[Minibits](https://minibits.cash)** and *only*')
    expect(convertInline('<a href="https://testnut.cashu.space" target="_blank"><code>testnut.cashu.space</code></a>'))
      .toBe('[`testnut.cashu.space`](https://testnut.cashu.space)')
    expect(convertInline('see <Link to="/methodology">the methodology</Link>')).toBe('see [the methodology](https://mintradar.org/methodology)')
  })

  it('a tag it does not convert fails loudly instead of being dropped', () => {
    expect(unconvertedText('<h2>A</h2><p>B</p>')).toBe('')
    expect(unconvertedText('<h4>Lost</h4><p>B</p>')).toBe('<h4>Lost</h4>')
    expect(() => parseModuleSource(META4, page('<h2>A</h2><table><tr><td>x</td></tr></table>'))).toThrow(/does not convert/)
    expect(() => parseModuleSource(META4, page('<p>x</p>', 'Another title'))).toThrow(/title/)
  })
})

describe('learn module Markdown: the real module pages', () => {
  const modules = parseAllModules(MODULES_DIR)

  it('titles and summaries are the site\'s Learn module list, in order', () => {
    expect(modules.map(m => [m.order, m.title, m.summary])).toEqual(
      [...LEARN_MODULES].sort((a, b) => a.order - b.order).map(m => [m.order, m.title, m.summary]))
  })

  it('every <h2> of every module page is a ## heading, in the same order', () => {
    for (const m of modules) {
      const src = readFileSync(path.join(MODULES_DIR, `Module${m.order}.tsx`), 'utf-8')
      const h2 = [...src.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map(x => `## ${convertInline(x[1]!)}`)
      expect(h2.length, `Module${m.order}`).toBeGreaterThan(0)
      expect(m.content.split('\n').filter(l => l.startsWith('## ')), `Module${m.order}`).toEqual(h2)
    }
  })

  it('no JSX is left in the Markdown', () => {
    for (const m of modules) expect(m.content, `Module${m.order}`).not.toMatch(/<\/?[A-Za-z][^>]*>|className=/)
  })

  it('Module 4 carries the Fees section with its three paragraphs', () => {
    const c = modules.find(m => m.order === 4)!.content
    const fees = c.slice(c.indexOf('## Fees'), c.indexOf('## Backing up your wallet'))
    expect(fees).toContain('**input fee**')
    expect(fees).toContain('**Lightning fee reserve**')
    expect(fees).toContain('**Fees and limits**')
    expect(fees.split('\n\n').filter(Boolean)).toHaveLength(4)
    expect(c.indexOf('## Sending and receiving tokens')).toBeLessThan(c.indexOf('## Fees'))
  })

  it('finds the module pages next to the backend by default', () => {
    expect(path.resolve(findModulesDir())).toBe(path.resolve(MODULES_DIR))
  })
})
