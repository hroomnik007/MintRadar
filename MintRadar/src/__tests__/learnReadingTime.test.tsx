// Reading time on the Learn index cards: `readingMinutes` in src/constants/learnModules.ts is a constant per
// module, and this test recomputes it from the real rendered text of each module so the numbers cannot drift.
// Rule: minutes = max(1, ceil(words / 200)); words = whitespace-separated tokens of the visible text
// (headings, paragraphs, lists, table text, diagram labels), without code blocks, svg, visually hidden text
// and the page chrome (back link, previous/next), which is not part of the module component.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentType } from 'react'
import { LEARN_MODULES } from '@/constants/learnModules'
import Module1 from '@/pages/learn/Module1'
import Module2 from '@/pages/learn/Module2'
import Module3 from '@/pages/learn/Module3'
import Module4 from '@/pages/learn/Module4'
import Module5 from '@/pages/learn/Module5'

const MODULE_COMPONENTS: Record<string, ComponentType> = {
  'cashu-basics': Module1,
  'understanding-the-risks': Module2,
  'how-to-choose-a-mint': Module3,
  'getting-started-with-a-wallet': Module4,
  'safe-habits': Module5,
}

const WORDS_PER_MINUTE = 200
const INLINE = new Set(['A', 'ABBR', 'B', 'CODE', 'EM', 'I', 'MARK', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUP'])
const SKIPPED = new Set(['PRE', 'SVG', 'SCRIPT', 'STYLE'])

function isHidden(el: Element): boolean {
  return SKIPPED.has(el.tagName.toUpperCase())
    || el.getAttribute('aria-hidden') === 'true'
    || el.hasAttribute('hidden')
    || el.classList.contains('sr-only')
}

// Visible text of a subtree; block elements are separated by a space so that adjacent <li>/<td>/<p> do not fuse.
function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as Element
  if (isHidden(el)) return ''
  const inner = Array.from(el.childNodes).map(visibleText).join('')
  return INLINE.has(el.tagName.toUpperCase()) ? inner : ` ${inner} `
}

function wordsOf(Module: ComponentType): number {
  const { container, unmount } = render(<MemoryRouter><Module /></MemoryRouter>)
  const words = visibleText(container).split(/\s+/).filter(Boolean).length
  unmount()
  return words
}

const minutesFor = (words: number) => Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))

describe('Learn reading time', () => {
  it('every module in the registry has a component here', () => {
    expect(Object.keys(MODULE_COMPONENTS).sort()).toEqual(LEARN_MODULES.map(m => m.id).sort())
  })

  it.each(LEARN_MODULES.map(m => [m.id, m.readingMinutes] as const))('%s: readingMinutes matches its text', (id, declared) => {
    const Module = MODULE_COMPONENTS[id]
    if (!Module) throw new Error(`No component registered for Learn module "${id}" in this test`)
    const words = wordsOf(Module)
    const expected = minutesFor(words)
    expect(
      declared,
      `Learn module "${id}": readingMinutes is ${declared}, but its text has ${words} words = ${expected} min `
      + `(max(1, ceil(words / ${WORDS_PER_MINUTE}))). Set readingMinutes: ${expected} for "${id}" in src/constants/learnModules.ts.`,
    ).toBe(expected)
  })
})
