// The /for-wallets section "Signed health assertions on Nostr (early version)" and the pointer on /methodology, against
// the shared constants, the NIP-05 file and the router/link rules.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import type { ReactElement } from 'react'
import { render, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { nip19 } from 'nostr-tools'
import ForWallets from '@/pages/ForWallets'
import { ATTESTATION_NIP05, ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC, HEALTH_ASSERTION_TAGS } from '@/utils/healthAssertionConstants'
import { ATTESTATION_NPUB, HEALTH_SECTION_ID, HEALTH_SECTION_TITLE, HEALTH_EXAMPLE_URL, HEALTH_SPEC_URL } from '@/constants/healthAssertionPage'
import { VERIFY_HEALTH_SNIPPET, VERIFY_HEALTH_INSTALL, VERIFY_HEALTH_RUNTIME_SENTENCE } from '@/constants/verifyHealthSnippet'

const renderPage = (el: ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>)
const section = (): HTMLElement => {
  const { container } = renderPage(<ForWallets />)
  const s = container.querySelector(`#${HEALTH_SECTION_ID}`)?.closest('section')
  if (!s) throw new Error('section missing')
  return s as HTMLElement
}

describe('the signed health assertions section on /for-wallets', () => {
  it('has the heading and anchor, after the API sections and before Suggested UX', () => {
    const { container } = renderPage(<ForWallets />)
    const h2s = [...container.querySelectorAll('h2')].map(h => h.id)
    expect(h2s.indexOf(HEALTH_SECTION_ID)).toBeGreaterThan(h2s.indexOf('stability'))
    expect(h2s.indexOf(HEALTH_SECTION_ID)).toBe(h2s.indexOf('ux') - 1)
    expect(container.querySelector(`#${HEALTH_SECTION_ID}`)?.textContent).toBe(HEALTH_SECTION_TITLE)
    expect(HEALTH_SECTION_TITLE).toBe('Signed health assertions on Nostr (early version)')
    expect(container.querySelector(`.about-toc a[href$="#${HEALTH_SECTION_ID}"]`)).not.toBeNull()
  })

  it('shows the early-version notice with the honest framing', () => {
    const note = within(section()).getByTestId('early-version-notice')
    for (const needle of ['Early version', 'MintRadar\'s own tags', 'rank', 'comment_cnt', 'reaction_cnt', 'may change before it is frozen', 'announced on this page', 'methodology']) {
      expect(note.textContent).toContain(needle)
    }
  })

  it('shows the npub and the hex; npub, hex, the NIP-05 file and the shared constant are one key', () => {
    const s = section()
    const shown = [...s.querySelectorAll('pre code')].map(c => c.textContent ?? '')
    const npub = shown.find(t => t.startsWith('npub1'))!
    const hex = shown.find(t => /^[0-9a-f]{64}$/.test(t))!
    expect(npub).toBe(ATTESTATION_NPUB)
    const decoded = nip19.decode(npub)
    expect(decoded.type).toBe('npub')
    expect(decoded.data).toBe(ATTESTATION_PUBKEY_HEX)
    expect(hex).toBe(ATTESTATION_PUBKEY_HEX)
    const file = JSON.parse(readFileSync(resolve(__dirname, '../../public/.well-known/nostr.json'), 'utf8')) as { names: Record<string, string> }
    expect(file.names['health']).toBe(decoded.data)
    expect(s.textContent).toContain(ATTESTATION_NIP05)
    expect(s.textContent).toMatch(/Pin this public key/)
  })

  it('lists the public relays of the constant, and not relay.damus.io', () => {
    const s = section()
    const relays = [...s.querySelectorAll('[data-testid="health-relays"] code')].map(c => c.textContent)
    expect(relays).toEqual([...ATTESTATION_RELAYS_PUBLIC])
    expect(s.textContent).not.toMatch(/damus/i)
  })

  it('the tag table has one row per tag of HEALTH_ASSERTION_TAGS, marked by who defines it', () => {
    const s = section()
    const rows = [...s.querySelectorAll('tr[data-tag]')]
    expect(rows.map(r => r.getAttribute('data-tag'))).toEqual(HEALTH_ASSERTION_TAGS.map(t => t.name))
    for (const [i, t] of HEALTH_ASSERTION_TAGS.entries()) {
      const text = rows[i]!.textContent ?? ''
      expect(text).toContain(t.source === 'MintRadar' ? 'MintRadar tag' : `defined by ${t.source}`)
      expect(text).toContain(t.meaning)
    }
    expect(rows.filter(r => r.textContent!.includes('defined by NIP-85')).map(r => r.getAttribute('data-tag'))).toEqual(['d', 'rank'])
    expect(rows.find(r => r.getAttribute('data-tag') === 'k')!.textContent).toContain('defined by NIP-73')
  })

  it('shows the exact tested snippet', () => {
    const code = [...section().querySelectorAll('pre code')].map(c => c.textContent)
    expect(code).toContain(VERIFY_HEALTH_SNIPPET)
    expect(code).toContain(VERIFY_HEALTH_INSTALL)
  })

  it('states the runtime requirement once in the text and as the first line of the code', () => {
    const s = section()
    const prose = [...s.querySelectorAll('p')].map(p => p.textContent).join(' ')
    expect(prose.split(VERIFY_HEALTH_RUNTIME_SENTENCE)).toHaveLength(2)
    expect(VERIFY_HEALTH_SNIPPET.startsWith(`// ${VERIFY_HEALTH_RUNTIME_SENTENCE}`)).toBe(true)
    expect(VERIFY_HEALTH_RUNTIME_SENTENCE).toContain('Node 22 or newer')  })

  it('states the update and publication rules, the disclaimer and the key rotation', () => {
    const text = section().textContent ?? ''
    for (const needle of ['expires 48 hours', 'at most every 6 hours', 'if the score changed by at least 2 points', '24 hours old', 'Not published', 'onion or an IP address', 'unknown', 'not a bad mint',
      'Operational health signal, not solvency, not a recommendation to deposit funds', 'A new key would be announced on this page']) {
      expect(text, needle).toContain(needle)
    }
  })

  it('links to the example and the spec on GitHub with a safe rel; no verdict words as claims', () => {
    const s = section()
    for (const href of [HEALTH_EXAMPLE_URL, HEALTH_SPEC_URL]) {
      const a = s.querySelector(`a[href="${href}"]`)!
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
    expect(HEALTH_EXAMPLE_URL).toBe('https://github.com/hroomnik007/MintRadar/blob/main/MintRadar/docs/examples/verify-health.mjs')
    const prose = [...s.querySelectorAll('p, li, td')].map(e => e.textContent).join(' ')
    expect(prose.match(/.{20}\b(safe|secure|trusted|guarantee[ds]?|recommended|first|only)\b.{20}/i)?.[0]).toBeUndefined()
    expect(prose).not.toMatch(/\bthe (first|only) provider\b/i)
  })
})
