import { describe, expect, it } from 'vitest'
import { inlineEntryCss } from '../../vite-inline-css'

const HTML = '<head><link rel="stylesheet" crossorigin href="/assets/index-AAA.css"><link rel="stylesheet" href="/assets/other-BBB.css"></head>'

describe('inlineEntryCss (vite-inline-css.ts)', () => {
  it('replaces a known entry stylesheet with <style> plus a disabled, non-matching marker link', () => {
    const out = inlineEntryCss(HTML, { 'assets/index-AAA.css': 'body{color:red}' })
    expect(out).toContain('<style>body{color:red}</style><link rel="stylesheet" href="/assets/index-AAA.css" media="not all" disabled>')
    expect(out).not.toContain('crossorigin href="/assets/index-AAA.css"')
  })

  it('leaves a stylesheet that is not in the bundle untouched', () => {
    expect(inlineEntryCss(HTML, {})).toBe(HTML)
    expect(inlineEntryCss(HTML, { 'assets/index-AAA.css': 'a{}' })).toContain('<link rel="stylesheet" href="/assets/other-BBB.css">')
  })

  it('keeps absolute, data: and fragment url() references', () => {
    const css = '@font-face{src:url(/fonts/a.woff2)} .x{background:url("data:image/svg+xml,%3Csvg%3E")} .y{mask:url(#m)} .z{background:url(https://e.example/i.png)}'
    expect(inlineEntryCss(HTML, { 'assets/index-AAA.css': css })).toContain(`<style>${css}</style>`)
  })

  it('refuses a relative url(), which would resolve differently from the document', () => {
    expect(() => inlineEntryCss(HTML, { 'assets/index-AAA.css': '.a{background:url(./img.png)}' })).toThrow(/relative url/)
    expect(() => inlineEntryCss(HTML, { 'assets/index-AAA.css': ".a{background:url('img.png')}" })).toThrow(/relative url/)
  })

  it('refuses CSS that would close the <style> element early', () => {
    expect(() => inlineEntryCss(HTML, { 'assets/index-AAA.css': '.a{content:"</style>"}' })).toThrow(/<\/style/)
  })
})
