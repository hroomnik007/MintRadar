// Precompressed copies of the build output (Stage 2 perf, 2026-10-25): every compressible file of at least
// PRECOMPRESS_MIN_BYTES gets a `.gz` (gzip -9) next to it, written once at build. nginx serves it with the built-in
// `gzip_static on;` (ngx_http_gzip_static_module, part of the distro nginx; deploy/nginx.conf), so static files are
// no longer compressed per request and come out at level 9 instead of the on-the-fly level 5. No brotli on purpose:
// it would need a third-party nginx module (decided 2026-10-25, minimal external dependencies). Not precached: the
// Workbox globPatterns (vite.config.ts) do not match .gz. No dependency: node:zlib.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import type { Plugin, ResolvedConfig } from 'vite'

export const PRECOMPRESS_EXTENSIONS = ['.js', '.css', '.html', '.svg', '.json', '.webmanifest', '.xml', '.txt', '.yaml']
// Same threshold as nginx's gzip_min_length: smaller files are not worth a second request-path lookup.
export const PRECOMPRESS_MIN_BYTES = 1024

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** Writes `<file>.gz` for every compressible file under `dir`; returns how many files it did. */
export function precompressDir(dir: string): number {
  let n = 0
  for (const file of walk(dir)) {
    if (!PRECOMPRESS_EXTENSIONS.includes(extname(file))) continue
    const bytes = readFileSync(file)
    if (bytes.length < PRECOMPRESS_MIN_BYTES) continue
    writeFileSync(`${file}.gz`, gzipSync(bytes, { level: 9 }))
    n++
  }
  return n
}

export function precompressPlugin(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'mintradar-precompress',
    apply: 'build',
    enforce: 'post',
    configResolved(c) { config = c },
    // closeBundle runs after vite-plugin-pwa has written sw.js / workbox-*.js / registerSW.js.
    closeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        // resolve(): a relative outDir (the deploy build's default `dist`) is taken against the Vite root, an absolute one is left alone.
        const n = precompressDir(resolve(config.root, config.build.outDir))
        config.logger.info(`precompress: ${n} files → .gz`)
      },
    },
  }
}
