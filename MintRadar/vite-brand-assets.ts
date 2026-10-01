// Cache-busting for the brand assets that live un-hashed in public/ (favicons, app icons, OG image).
// nginx serves them with a long cache, so every reference in a build carries ?v=<first 8 hex of the
// file's sha256>: the URL changes exactly when the bytes change. Build only — dev leaves URLs alone.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

const SITE = 'https://mintradar.org'
const HTML_ASSETS = [
  '/favicon.ico',
  '/favicon-32x32.png',
  '/favicon-16x16.png',
  '/apple-touch-icon.png',
  '/og-image.png',
]

export function brandHash(publicPath: string, root = process.cwd()): string {
  const bytes = readFileSync(join(root, 'public', publicPath))
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8)
}

export function withBrandHash(publicPath: string, root = process.cwd()): string {
  return `${publicPath}?v=${brandHash(publicPath, root)}`
}

// Rewrites href/content attributes that point at one of HTML_ASSETS (relative or on SITE).
export function addBrandHashesToHtml(html: string, root = process.cwd()): string {
  return html.replace(/\b(href|content)="((?:https:\/\/mintradar\.org)?)(\/[^"?#]+)"/g, (match, attr: string, origin: string, path: string) =>
    HTML_ASSETS.includes(path) ? `${attr}="${origin}${withBrandHash(path, root)}"` : match,
  )
}

export function brandAssetsPlugin(): Plugin {
  return {
    name: 'mintradar-brand-asset-hashes',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: (html) => addBrandHashesToHtml(html) },
  }
}

export { SITE as BRAND_SITE, HTML_ASSETS as BRAND_HTML_ASSETS }
