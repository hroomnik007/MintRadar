// P1 (UI/UX report 2026-11-22): on "/mint/:url" the lazy MintDetail chunk (the page's LCP text waits on it) starts
// downloading at HTML parse time instead of after the entry bundle has run. The chunk URLs are hashed, while
// public/early-preload.js is un-hashed and cached for a year, so the URLs travel in the HTML (never long-cached) as
// a data attribute on the early-preload <script>; the script reads it via document.currentScript and adds
// <link rel="modulepreload"> only on that route. Build only: dev has no chunks.
import type { Plugin } from 'vite'

type ChunkLike = { type: 'chunk'; fileName: string; imports: string[]; isEntry: boolean; facadeModuleId: string | null }
type BundleLike = Record<string, ChunkLike | { type: 'asset' }>

export const MINT_DETAIL_MODULE = /\/src\/pages\/MintDetail\.tsx$/

/** "/assets/x.js /assets/y.js": the MintDetail chunk and its static imports that the entry does not load already. */
export function mintDetailModuleUrls(bundle: BundleLike, base = '/'): string[] {
  const chunks = Object.values(bundle).filter((c): c is ChunkLike => c.type === 'chunk')
  const byName = new Map(chunks.map(c => [c.fileName, c]))
  const page = chunks.find(c => c.facadeModuleId !== null && MINT_DETAIL_MODULE.test(c.facadeModuleId.replace(/\\/g, '/')))
  if (!page) return []
  const entryGraph = new Set<string>()
  const walk = (name: string) => {
    if (entryGraph.has(name)) return
    entryGraph.add(name)
    for (const dep of byName.get(name)?.imports ?? []) walk(dep)
  }
  for (const c of chunks) if (c.isEntry) walk(c.fileName)
  return [page.fileName, ...page.imports].filter(n => !entryGraph.has(n)).map(n => `${base}${n}`)
}

export function addMintDetailPreloadAttr(html: string, urls: string[]): string {
  if (urls.length === 0) return html
  return html.replace(/<script async src="(\/early-preload\.js[^"]*)"><\/script>/,
    (_m, src: string) => `<script async src="${src}" data-mint-detail-modules="${urls.join(' ')}"></script>`)
}

export function routePreloadPlugin(): Plugin {
  return {
    name: 'mintradar-route-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) => (ctx.bundle ? addMintDetailPreloadAttr(html, mintDetailModuleUrls(ctx.bundle as unknown as BundleLike)) : html),
    },
  }
}
