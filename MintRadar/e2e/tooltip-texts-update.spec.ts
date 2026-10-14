import { writeFileSync } from 'node:fs'
import { test } from '@playwright/test'
import { TOOLTIP_STATES } from './fixtures/tooltipStates'
import { extractTooltipTexts } from './fixtures/tooltipExtract'

// Regenerates e2e/fixtures/tooltip-texts.json, the text of every tooltip (and explanatory title) of every state in
// TOOLTIP_STATES at 1440 and 390 px, which tooltips-contract.spec.ts compares against. NOT part of a normal run:
//   TT_WRITE_TEXTS=1 npx playwright test e2e/tooltip-texts-update.spec.ts
// then review the diff of the JSON: it is the list of texts users see.
test.skip(!process.env.TT_WRITE_TEXTS, 'run with TT_WRITE_TEXTS=1 to rewrite e2e/fixtures/tooltip-texts.json')

test('write e2e/fixtures/tooltip-texts.json', async ({ browser }) => {
  test.setTimeout(1_500_000)
  const out: Record<string, { texts: string[]; triggers: number }> = {}
  for (const width of [1440, 390]) {
    const height = width === 1440 ? 900 : 844
    for (const state of TOOLTIP_STATES) {
      const ctx = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' })
      const page = await ctx.newPage()
      await page.addInitScript(() => {
        const s = document.createElement('style')
        s.textContent = '*,*::before,*::after{animation-duration:0.001s !important;transition-duration:0.001s !important;scroll-behavior:auto !important}'
        document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s))
      })
      if (await state.run(page)) out[`${state.id}@${width}`] = await extractTooltipTexts(page)
      await ctx.close()
    }
  }
  const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(new URL('./fixtures/tooltip-texts.json', import.meta.url), JSON.stringify(sorted, null, 2) + '\n')
})
