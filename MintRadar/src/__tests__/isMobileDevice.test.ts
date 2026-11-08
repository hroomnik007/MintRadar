import { describe, it, expect, afterEach, vi } from 'vitest'
import { isMobileDevice } from '@/utils/isMobileDevice'

const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
const setUa = (ua: string, mobile?: boolean) => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  Object.defineProperty(nav, 'userAgentData', { value: mobile === undefined ? undefined : { mobile }, configurable: true })
}
afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(nav, 'userAgentData', { value: undefined, configurable: true }) })

describe('isMobileDevice', () => {
  it('uses userAgentData.mobile when the browser provides it', () => {
    setUa('Mozilla/5.0 (X11; Linux x86_64) Chrome/130', true)
    expect(isMobileDevice()).toBe(true)
    setUa('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari', false)
    expect(isMobileDevice()).toBe(false)
  })
  it('falls back to the user agent', () => {
    setUa('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit Chrome/130 Mobile Safari/537.36')
    expect(isMobileDevice()).toBe(true)
    setUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari')
    expect(isMobileDevice()).toBe(true)
    setUa('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')
    expect(isMobileDevice()).toBe(false)
  })
})
