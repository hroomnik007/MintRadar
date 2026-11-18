// New versions take over open pages (skipWaiting + clientsClaim) and open pages check for updates.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../..')
const CFG = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8')
const REGISTER_SW = fs.readFileSync(path.join(ROOT, 'public/registerSW.js'), 'utf8')
const MIN = 60 * 1000

describe('workbox options in vite.config.ts', () => {
  const workbox = CFG.slice(CFG.indexOf('workbox: {'))
  it('sets skipWaiting and clientsClaim explicitly (autoUpdate does not with injectRegister "script-defer")', () => {
    expect(CFG).toContain("registerType: 'autoUpdate'")
    expect(CFG).toContain("injectRegister: 'script-defer'")
    expect(workbox).toMatch(/skipWaiting:\s*true/)
    expect(workbox).toMatch(/clientsClaim:\s*true/)
  })
  it('keeps the precache list untouched', () => {
    expect(workbox).toContain("globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']")
    expect(workbox).toContain("globIgnores: ['profile/**']")
  })
})

// Runs the real public/registerSW.js against a fake browser to test the update-check throttling.
describe('registerSW.js update check', () => {
  let update: ReturnType<typeof vi.fn>
  let visibility: 'visible' | 'hidden'
  let onVisibility: (() => void) | undefined
  let addCalls: string[]

  beforeEach(async () => {
    vi.useFakeTimers()
    visibility = 'visible'
    onVisibility = undefined
    addCalls = []
    update = vi.fn(() => Promise.resolve())
    const sw = {
      controller: {},
      addEventListener: () => {},
      register: () => Promise.resolve({ update }),
    }
    let onLoad: (() => void) | undefined
    const win = { addEventListener: (_: string, f: () => void) => { onLoad = f }, location: { reload: vi.fn() } }
    const doc = {
      get visibilityState() { return visibility },
      addEventListener: (type: string, f: () => void) => { addCalls.push(type); if (type === 'visibilitychange') onVisibility = f },
    }
    new Function('navigator', 'window', 'document', 'setInterval', 'Promise', REGISTER_SW)(
      { serviceWorker: sw }, win, doc, setInterval, Promise,
    )
    onLoad?.()
    await vi.advanceTimersByTimeAsync(0) // let register().then(...) run
  })
  afterEach(() => vi.useRealTimers())

  const show = () => { visibility = 'visible'; onVisibility?.() }

  it('registers exactly one visibilitychange listener', () => {
    expect(addCalls).toEqual(['visibilitychange'])
  })
  it('does not check when the page returns within 30 minutes', async () => {
    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(29 * MIN)
    show()
    expect(update).not.toHaveBeenCalled()
  })
  it('checks when the page returns after 30 minutes, then throttles again', async () => {
    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(31 * MIN)
    show()
    expect(update).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10 * MIN)
    show()
    expect(update).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(21 * MIN)
    show()
    expect(update).toHaveBeenCalledTimes(2)
  })
  it('ignores visibilitychange to hidden', async () => {
    await vi.advanceTimersByTimeAsync(40 * MIN)
    visibility = 'hidden'
    onVisibility?.()
    expect(update).not.toHaveBeenCalled()
  })
  it('checks hourly while visible and never while hidden', async () => {
    await vi.advanceTimersByTimeAsync(60 * MIN)
    expect(update).toHaveBeenCalledTimes(1)
    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(120 * MIN)
    expect(update).toHaveBeenCalledTimes(1)
  })
  it('swallows a failing or throwing update()', async () => {
    update.mockImplementationOnce(() => Promise.reject(new Error('offline')))
    await vi.advanceTimersByTimeAsync(60 * MIN)
    update.mockImplementationOnce(() => { throw new Error('sync') })
    expect(() => show()).not.toThrow()
    await vi.advanceTimersByTimeAsync(60 * MIN)
    expect(update).toHaveBeenCalledTimes(2)
  })
})
