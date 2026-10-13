// The pointer on /methodology to the signed health assertions of /for-wallets.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Methodology from '@/pages/Methodology'
import { METHODOLOGY_VERSION } from '@/utils/methodology'
import { HEALTH_SECTION_ID } from '@/constants/healthAssertionPage'

describe('the pointer on /methodology', () => {
  it('has a short section that links to the anchor and names the methodology number', () => {
    const { container } = render(<MemoryRouter><Methodology /></MemoryRouter>)
    const h = container.querySelector('#where-published')!
    expect(h.textContent).toBe('Where the score is published')
    const sec = h.closest('section')!
    const a = sec.querySelector(`a[href="/for-wallets#${HEALTH_SECTION_ID}"]`)
    expect(a).not.toBeNull()
    expect(sec.textContent).toContain('rank')
    expect(sec.textContent).toContain('methodology')
    expect(sec.textContent).toContain(`currently ${METHODOLOGY_VERSION}`)
    expect(container.querySelector('.about-toc a[href$="#where-published"]')).not.toBeNull()
  })
})
