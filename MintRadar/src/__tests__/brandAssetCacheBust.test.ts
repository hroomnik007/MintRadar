// Brand assets live un-hashed in public/ and nginx caches them for a year, so every reference carries
// ?v=<first 8 hex of sha256(file)> in builds (vite-brand-assets.ts). Dev leaves the URLs alone.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { addBrandHashesToHtml, brandAssetsPlugin, brandHash, withBrandHash, BRAND_HTML_ASSETS } from '../../vite-brand-assets'

const ROOT = process.cwd()
const sha8 = (file: string) => createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'public', file))).digest('hex').slice(0, 8)

describe('brand asset cache-busting', () => {
  const html = addBrandHashesToHtml(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'))

  it('og:image, twitter:image, favicons and apple-touch-icon carry ?v=<8 hex> equal to the file hash', () => {
    const refs = [
      /<meta property="og:image" content="https:\/\/mintradar\.org(\/og-image\.png)\?v=([0-9a-f]{8})"/,
      /<meta name="twitter:image" content="https:\/\/mintradar\.org(\/og-image\.png)\?v=([0-9a-f]{8})"/,
      /<link rel="apple-touch-icon" href="(\/apple-touch-icon\.png)\?v=([0-9a-f]{8})"/,
      /<link rel="icon" type="image\/x-icon" href="(\/favicon\.ico)\?v=([0-9a-f]{8})"/,
      /<link rel="icon" type="image\/png" sizes="32x32" href="(\/favicon-32x32\.png)\?v=([0-9a-f]{8})"/,
      /<link rel="icon" type="image\/png" sizes="16x16" href="(\/favicon-16x16\.png)\?v=([0-9a-f]{8})"/,
    ]
    for (const re of refs) {
      const m = re.exec(html)
      expect(m, String(re)).not.toBeNull()
      expect(m?.[2]).toBe(sha8(m?.[1] as string))
    }
  })

  it('every brand file referenced by index.html is covered, and nothing else is touched', () => {
    for (const a of BRAND_HTML_ASSETS) expect(html).toContain(`${a}?v=`)
    expect(html).toContain('href="/manifest.webmanifest"')
    expect(html).toContain('<meta name="theme-color" content="#0b1512" />')
    expect(html).toContain('href="https://mintradar.org/"')
  })

  it('manifest icons are wrapped in the hash helper and the hash matches the file', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8')
    const icons = [...cfg.matchAll(/src: icon\(command, '(\/icons\/icon-\d+x\d+\.png)'\)/g)].map(m => m[1] as string)
    expect(icons).toHaveLength(7)
    expect([...cfg.matchAll(/src: '/g)]).toHaveLength(0) // no manifest icon bypasses icon()
    for (const i of icons) expect(withBrandHash(i)).toBe(`${i}?v=${sha8(i)}`)
  })

  it('the hash changes only when the bytes change', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'))
    fs.mkdirSync(path.join(dir, 'public'))
    const f = path.join(dir, 'public', 'x.png')
    fs.writeFileSync(f, Buffer.from([1, 2, 3]))
    const a = brandHash('/x.png', dir)
    expect(brandHash('/x.png', dir)).toBe(a)
    fs.writeFileSync(f, Buffer.from([1, 2, 4]))
    expect(brandHash('/x.png', dir)).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    fs.rmSync(dir, { recursive: true })
  })

  it('applies to builds only (dev keeps plain URLs)', () => {
    expect(brandAssetsPlugin().apply).toBe('build')
    expect(fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8')).toContain("command === 'build'")
  })

  it('workbox ignores the v parameter so a ?v= request still matches its precache entry', () => {
    expect(fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8')).toContain('/^v$/')
  })
})
