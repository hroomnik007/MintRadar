import { expect, type Locator, type Page } from '@playwright/test'

// Deterministic replacements for fixed waits (see docs/claude/e2e-conventions.md). Nothing here sleeps: every
// helper waits for something the browser can report (frames painted, a message-channel task, a network round trip
// that was queued behind earlier requests, a box that stopped moving).

/** Resolves after `n` animation frames have been painted. (Not usable with page.clock.install(): rAF is faked then.) */
export const frames = (page: Page, n = 2): Promise<void> =>
  page.evaluate(count => new Promise<void>(done => {
    const step = (left: number): void => { if (left === 0) done(); else requestAnimationFrame(() => step(left - 1)) }
    step(count)
  }), n)

const barrierInstalled = new WeakSet<Page>()

/**
 * A barrier for NEGATIVE assertions ("nothing was requested", "the list did not change"). After the positive condition
 * the test already awaited, it lets the page finish the work that is already queued: two painted frames, one
 * message-channel task, and a request to a route handled by the test itself. Requests are intercepted in the order the
 * page issued them, so when the barrier request is served every earlier request has already reached its route handler
 * (and the handler has recorded it). It does not prove that nothing happens later; it proves that nothing the page had
 * already started is still on its way.
 */
export async function flush(page: Page): Promise<void> {
  if (!barrierInstalled.has(page)) {
    barrierInstalled.add(page)
    await page.route('**/__e2e_barrier__', route => route.fulfill({ status: 204, body: '' }))
  }
  await frames(page)
  await page.evaluate(async () => {
    await new Promise<void>(done => {
      const channel = new MessageChannel()
      channel.port1.onmessage = () => done()
      channel.port2.postMessage(0)
    })
    await fetch('/__e2e_barrier__').catch(() => undefined)
  })
}

/** Resizes the viewport and waits until the page reports the new size and has painted with it. */
export async function resize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height })
  await expect.poll(() => page.evaluate(() => window.innerWidth), { message: `viewport is ${width}px wide` }).toBe(width)
  await frames(page)
}

/** Waits for the web fonts and two painted frames: the layout a screenshot or a measurement should see. */
export async function layoutReady(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await frames(page)
}

/** Scrolls the element to the middle of the viewport and waits until it is in view and its box stopped moving. */
export async function scrollToStable(locator: Locator): Promise<void> {
  const page = locator.page()
  await locator.evaluate(el => el.scrollIntoView({ block: 'center', inline: 'center' }))
  await expect(locator).toBeInViewport()
  await expect.poll(async () => {
    const before = await locator.boundingBox()
    await frames(page)
    const after = await locator.boundingBox()
    return !!before && !!after && before.x === after.x && before.y === after.y && before.width === after.width && before.height === after.height
  }, { message: 'the element has a stable box in the viewport' }).toBe(true)
}
