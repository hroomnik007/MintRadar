// The "Build a request" section of /for-wallets (components/WalletRequestBuilder.tsx): state only, no storage, no
// request, and every value goes through buildWalletRequest before it reaches a snippet.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, fireEvent, screen, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { WalletRequestBuilder } from '@/components/WalletRequestBuilder'
import { WALLET_API_BASE, WALLET_EXAMPLES } from '@/constants/forWalletsPage'
import { TRACKED_NUTS } from '@/constants/nuts'

const BARE = `${WALLET_API_BASE}/wallets/mints`
const example = (id: string) => WALLET_EXAMPLES.find(e => e.id === id)!.code

let fetchSpy: ReturnType<typeof vi.fn>
let setItem: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  setItem = vi.spyOn(Storage.prototype, 'setItem')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const renderBuilder = () => render(<MemoryRouter><WalletRequestBuilder /></MemoryRouter>)
const curl = () => screen.getByLabelText('Request builder: curl').textContent
const fetchCode = () => screen.getByLabelText('Request builder: fetch').textContent
const more = () => screen.getByRole('button', { name: /More options/ })
const expand = () => { if (more().getAttribute('aria-expanded') === 'false') fireEvent.click(more()) }

describe('WalletRequestBuilder', () => {
  it('with nothing set the output is the bare list request', () => {
    renderBuilder()
    expect(curl()).toBe(`curl -s "${BARE}"`)
    expect(fetchCode()).toContain(`fetch('${BARE}')`)
  })

  it('Unit SAT plus minScore 70 equals the list-curl and list-fetch examples', () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'SAT' }))
    fireEvent.change(screen.getByLabelText(/Minimum score/), { target: { value: '70' } })
    expect(curl()).toBe(example('list-curl'))
    expect(fetchCode()).toBe(example('list-fetch'))
    expect(screen.getByLabelText(/Minimum score/).getAttribute('aria-valuetext')).toBe('70')
  })

  it('shows "any" at minScore 0', () => {
    renderBuilder()
    expect(screen.getByLabelText(/Minimum score/).getAttribute('aria-valuetext')).toBe('any')
    expect(document.querySelector('.wg-readout')!.textContent).toBe('any')
  })

  it('one chip per tracked NUT, and the chips build the nuts list', () => {
    renderBuilder()
    const group = screen.getByRole('group', { name: /Required NUTs/ })
    expect(within(group).getAllByRole('checkbox')).toHaveLength(TRACKED_NUTS.length)
    fireEvent.click(within(group).getByRole('checkbox', { name: /NUT-12/ }))
    fireEvent.click(within(group).getByRole('checkbox', { name: /NUT-11/ }))
    expect(curl()).toContain('?nuts=11,12')
  })

  it('an invalid limit shows an error under the field and stays out of the output; the rest keeps working', () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'EUR' }))
    const limit = screen.getByLabelText(/^Limit/)
    fireEvent.change(limit, { target: { value: '500' } })
    expect(limit.getAttribute('aria-invalid')).toBe('true')
    const msg = document.getElementById(limit.getAttribute('aria-describedby')!)!
    expect(msg.textContent).toMatch(/limit must be an integer from 1 to 200/)
    expect(curl()).toBe(`curl -s "${BARE}?unit=eur"`)
    expect(curl()).not.toContain('limit')
    fireEvent.change(limit, { target: { value: '50' } })
    expect(limit.getAttribute('aria-invalid')).toBeNull()
    expect(curl()).toContain('limit=50')
  })

  it('Other unit wins over the Unit segment, which then shows no selection', () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'SAT' }))
    expand()
    fireEvent.change(screen.getByLabelText(/Other unit/), { target: { value: 'msat' } })
    expect(curl()).toBe(`curl -s "${BARE}?unit=msat"`)
    const unit = screen.getByRole('group', { name: /^Unit/ })
    expect(within(unit).getAllByRole('radio').filter(r => (r as HTMLInputElement).checked)).toHaveLength(0)
    // clearing Other unit gives the Unit segment its choice back
    fireEvent.change(screen.getByLabelText(/Other unit/), { target: { value: '' } })
    expect(curl()).toBe(`curl -s "${BARE}?unit=sat"`)
    expect((screen.getByRole('radio', { name: 'SAT' }) as HTMLInputElement).checked).toBe(true)
  })

  it('an invalid Other unit is reported and left out', () => {
    renderBuilder()
    expand()
    const other = screen.getByLabelText(/Other unit/)
    fireEvent.change(other, { target: { value: 'a b"c' } })
    expect(other.getAttribute('aria-invalid')).toBe('true')
    expect(curl()).toBe(`curl -s "${BARE}"`)
  })

  it('"More options" is collapsed by default, controls its panel and counts the fields set', () => {
    renderBuilder()
    const btn = more()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    const panel = document.getElementById(btn.getAttribute('aria-controls')!)!
    expect(panel.hidden).toBe(true)
    expect(btn.textContent).not.toMatch(/set\)/)
    fireEvent.click(btn)
    expect(panel.hidden).toBe(false)
    fireEvent.click(screen.getByRole('radio', { name: 'true' }))
    expect(more().textContent).toContain('(1 set)')
    fireEvent.click(screen.getByRole('checkbox', { name: /Test mints/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /^facts$/ }))
    fireEvent.change(screen.getByLabelText(/Max input fee/), { target: { value: '100' } })
    expect(more().textContent).toContain('(4 set)')
    fireEvent.click(screen.getByRole('checkbox', { name: /Test mints/ }))
    expect(more().textContent).toContain('(3 set)')
    expect(curl()).toContain('eligible=true')
    expect(curl()).toContain('include=facts')
    expect(curl()).toContain('maxInputFeePpk=100')
  })

  it('Reset returns the form to its initial state and collapses More options', () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'USD' }))
    fireEvent.change(screen.getByLabelText(/Minimum score/), { target: { value: '50' } })
    expand()
    fireEvent.click(screen.getByRole('checkbox', { name: /Offline/ }))
    fireEvent.change(screen.getByLabelText(/^Limit/), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(curl()).toBe(`curl -s "${BARE}"`)
    expect(more().getAttribute('aria-expanded')).toBe('false')
    expect(more().textContent).not.toMatch(/set\)/)
    expect((screen.getByLabelText(/^Limit/) as HTMLInputElement).value).toBe('')
    expect(screen.getByLabelText(/^Limit/).getAttribute('aria-invalid')).toBeNull()
    expect((screen.getByLabelText(/Minimum score/) as HTMLInputElement).value).toBe('0')
    expect((screen.getByRole('radio', { name: 'USD' }) as HTMLInputElement).checked).toBe(false)
  })

  it('never calls fetch and never writes to localStorage or sessionStorage (one spy covers both: both are Storage)', () => {
    renderBuilder()
    fireEvent.click(screen.getByRole('radio', { name: 'SAT' }))
    fireEvent.change(screen.getByLabelText(/Minimum score/), { target: { value: '80' } })
    fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    expand()
    fireEvent.change(screen.getByLabelText(/Changed since/), { target: { value: '2026-10-20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it('has unique code block titles, labelled groups and a link to the polling section', () => {
    renderBuilder()
    expand()
    const link = screen.getByRole('link', { name: 'Polling and caching' })
    expect(link.getAttribute('href')).toBe('/#polling')
    expect(screen.getByText(/This is a single request\. To fetch repeatedly, see/)).toBeTruthy()
    expect(screen.getAllByRole('group').length).toBeGreaterThanOrEqual(4)
    expect(document.querySelector('[data-param],[data-field],[data-code]')).toBeNull()
    expect(document.body.textContent).not.toMatch(/undefined|NaN|\bnull\b/)
  })

  it('renders hostile text as text and leaves it out of the output', () => {
    renderBuilder()
    expand()
    fireEvent.change(screen.getByLabelText(/Changed since/), { target: { value: '<img src=x onerror=alert(1)>' } })
    expect(document.querySelector('img')).toBeNull()
    expect(curl()).toBe(`curl -s "${BARE}"`)
  })
})
