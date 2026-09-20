import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MintFavicon } from '@/components/mint/MintFavicon'
import { _resetMintIconFailureCache } from '@/utils/mintIconFailureCache'

// Regression coverage for the 2026-09-07 audit finding: a mint-controlled
// icon_url used to be rendered as <img src={iconUrl}> directly, so a hostile
// operator could point it at a tracker and harvest every viewer's IP / UA.
// The favicon now always loads through the backend's SSRF-guarded proxy.

describe('MintFavicon', () => {
  afterEach(() => {
    _resetMintIconFailureCache()
  })

  it('loads the icon through the backend proxy, never from the mint-supplied URL', () => {
    const { container } = render(
      <MintFavicon
        url="https://mint.example"
        iconUrl="https://tracker.evil.example/px.png?u=victim"
      />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe('/api/mint/icon?url=https%3A%2F%2Fmint.example')
    // The attacker-controlled URL must not appear anywhere in the rendered output.
    expect(container.innerHTML).not.toContain('tracker.evil.example')
  })

  it('URL-encodes the mint url into the proxy query', () => {
    const { container } = render(
      <MintFavicon url="https://mint.example:3338/Bitcoin" iconUrl="https://mint.example/i.png" />,
    )
    expect(container.querySelector('img')!.getAttribute('src')).toBe(
      `/api/mint/icon?url=${encodeURIComponent('https://mint.example:3338/Bitcoin')}`,
    )
  })

  it('renders a two-letter hostname monogram (no <img>) when the mint has no icon', () => {
    const { container } = render(<MintFavicon url="https://minibits.cash" iconUrl={null} />)
    expect(container.querySelector('img')).toBeNull()
    const placeholder = screen.getByLabelText(/mint icon placeholder/)
    expect(placeholder).toBeInTheDocument()
    expect(placeholder).toHaveTextContent('MI')
  })

  it('gives different mints different monograms', () => {
    const a = render(<MintFavicon url="https://minibits.cash" iconUrl={null} />).container
    const b = render(<MintFavicon url="https://coinos.io" iconUrl={null} />).container
    expect(a.textContent).not.toBe(b.textContent)
    expect(a.textContent).toBe('MI')
    expect(b.textContent).toBe('CO')
  })

  it('skips a leading mint./www. when building the monogram', () => {
    const { container } = render(<MintFavicon url="https://www.mint.example.com" iconUrl={null} />)
    expect(container.textContent).toBe('EX')
  })

  it('falls back to the placeholder monogram when the proxied image fails to load', () => {
    const { container } = render(
      <MintFavicon url="https://mint.example" iconUrl="https://mint.example/i.png" />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img!)
    expect(screen.getByLabelText(/mint icon placeholder/)).toBeInTheDocument()
    expect(container.querySelector('img')).toBeNull()
  })

  it('remembers a failed load across remounts and skips the request entirely', () => {
    const first = render(
      <MintFavicon url="https://flaky.example" iconUrl="https://flaky.example/i.png" />,
    )
    const img = first.container.querySelector('img')
    expect(img).not.toBeNull()
    fireEvent.error(img!)
    first.unmount()

    // A fresh mount for the same mint url (e.g. the grid re-rendering after a
    // sort/filter change) must go straight to the monogram, no <img> at all.
    const second = render(
      <MintFavicon url="https://flaky.example" iconUrl="https://flaky.example/i.png" />,
    )
    expect(second.container.querySelector('img')).toBeNull()
    expect(screen.getAllByLabelText(/mint icon placeholder/).length).toBeGreaterThan(0)
  })

  it('does not carry a failure over to a different mint url', () => {
    const first = render(
      <MintFavicon url="https://flaky2.example" iconUrl="https://flaky2.example/i.png" />,
    )
    fireEvent.error(first.container.querySelector('img')!)
    first.unmount()

    const second = render(
      <MintFavicon url="https://healthy2.example" iconUrl="https://healthy2.example/i.png" />,
    )
    expect(second.container.querySelector('img')).not.toBeNull()
  })
})
