// The two changed statements of /about (docs/claude/privacy-and-about.md has the claim -> source map): which
// audit source feeds the score, and the change policy of the wallet API v1 in the Rules.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import About from '@/pages/About'
import { WALLET_API_FACTS } from '@/constants/forWalletsPage'

function renderAbout() {
  return render(<MemoryRouter initialEntries={['/about']}><About /></MemoryRouter>)
}

const sectionOf = (headingId: string): HTMLElement => {
  const h = document.getElementById(headingId)
  if (!h) throw new Error(`#${headingId} not found`)
  return h.closest('section') as HTMLElement
}
const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim()

describe('About: audit sources', () => {
  it('names cashu.info as the source of the score part and audit.8333.space as the Audit tab only', () => {
    renderAbout()
    const how = squash(screen.getByText(/How we check\./).closest('p')!.textContent)
    expect(how).toContain('Audit data comes from third-party services and can be out of date; when it is, we say so.')
    expect(how).toContain('cashu.info feeds the audit part of the Reliability Score;')
    expect(how).toContain("audit.8333.space is only shown on a mint's Audit tab and is not part of the score.")
    // The old sentence put both services on the same footing.
    expect(how).not.toContain('(audit.8333.space and cashu.info)')
  })
})

describe('About: Rules', () => {
  it('states the v1 change policy with the notice period from the constant and links to #stability', () => {
    renderAbout()
    const rules = sectionOf('terms')
    const text = squash(rules.textContent)
    expect(text).toContain('The service has rate limits. The wallet API (v1) only changes by adding fields and parameters,')
    expect(text).toContain(`a removal is announced at least ${WALLET_API_FACTS.deprecationNoticeDays} days ahead (see For wallets);`)
    // The text follows the constant, and the constant is the number the wallet documents promise.
    const promised = /at least \*\*(\d+) days\*\*/.exec(readFileSync(resolve(__dirname, '../../docs/API.md'), 'utf8'))?.[1]
    expect(promised, 'docs/API.md Stability: notice period').toBeDefined()
    expect(text).toContain(`announced at least ${promised} days ahead`)
    expect(text).toContain('every other API route may change without notice.')
    expect(text).not.toContain('the API may change')
    const link = rules.querySelector('a[href="/for-wallets#stability"]')
    expect(link?.textContent).toBe('For wallets')
  })

  it('does not mention response headers (no code sends Deprecation or Sunset)', () => {
    const { container } = renderAbout()
    expect(container.textContent).not.toMatch(/Deprecation|Sunset/)
  })
})

describe('About: dates', () => {
  it('"Your data" and "Rules" each carry their own last-updated date', () => {
    renderAbout()
    const date = (id: string) => squash(sectionOf(id).querySelector('.about-updated')?.textContent)
    expect(date('privacy')).toBe('Last updated 12 October 2026')
    expect(date('terms')).toBe('Last updated 17 October 2026')
  })
})
