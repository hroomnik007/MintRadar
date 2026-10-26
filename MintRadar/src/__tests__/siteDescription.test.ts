import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAGE_META, ROUTE_META_BY_PATH, SITE_DESCRIPTION } from '@/utils/pageMeta'

// The words the app's own rules forbid as a verdict (docs/claude/mobile-and-tooltips.md, tooltipTexts.test.ts).
const VERDICT = /\b(trusted|safe|safely|secure|securely|guaranteed?|recommended?)\b/i
const MAX_DESCRIPTION = 160
const LENGTH_EXCEPTIONS: Record<string, number> = {}
// Existing page copy that names a topic, not a verdict on any mint ("how to choose a safe Cashu mint" is what the
// Learn course teaches). Listed by name so a new description with a verdict word still fails.
const VERDICT_EXCEPTIONS = new Set(['ROUTE_META_BY_PATH /learn'])

const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')
const tag = (re: RegExp) => {
  const m = indexHtml.match(re)
  const content = m?.[1]
  if (content === undefined) throw new Error(`index.html: tag not found for ${re}`)
  return content.replace(/&amp;/g, '&')
}
const headDescriptions = {
  'meta description': tag(/<meta name="description" content="([^"]*)"/),
  'og:description': tag(/<meta property="og:description" content="([^"]*)"/),
  'twitter:description': tag(/<meta name="twitter:description" content="([^"]*)"/),
}

describe('site description (head defaults)', () => {
  it.each(Object.entries(headDescriptions))('index.html %s is the one site description', (_name, text) => {
    expect(text).toBe(SITE_DESCRIPTION)
  })

  it('has no verdict word and fits a snippet', () => {
    expect(SITE_DESCRIPTION).not.toMatch(VERDICT)
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(MAX_DESCRIPTION)
  })
})

describe('per-page descriptions', () => {
  const all: Array<[string, string]> = [
    ...Object.entries(PAGE_META).map(([k, v]): [string, string] => [`PAGE_META ${k}`, v.description]),
    ...Object.entries(ROUTE_META_BY_PATH).map(([k, v]): [string, string] => [`ROUTE_META_BY_PATH ${k}`, v.description]),
  ]
  it.each(all)('%s has no verdict word and is at most 160 characters', (name, text) => {
    if (!VERDICT_EXCEPTIONS.has(name)) expect(text).not.toMatch(VERDICT)
    expect(text.length).toBeLessThanOrEqual(LENGTH_EXCEPTIONS[name] ?? MAX_DESCRIPTION)
  })
})
