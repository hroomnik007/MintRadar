// Precompressed copies of the build output (Stage 2 perf, 2026-10-25): every compressible file of at least
// PRECOMPRESS_MIN_BYTES gets a `.br` (brotli, quality 11) and a `.gz` (gzip -9) next to it, written once at build.
// nginx serves them only when told to: `gzip_static on;` (module built into the distro nginx) and
// `brotli_static on;` (needs the ngx_brotli module, e.g. Debian/Ubuntu `libnginx-mod-http-brotli-static`).
// deploy/nginx.conf is reference-only and applied by hand on the server (docs/claude/deploy-and-infra.md,
// "Brotli"); until it is, nginx ignores these files and keeps compressing on the fly. They are not precached:
// the Workbox globPatterns (vite.config.ts) do not match .br/.gz. No dependency: node:zlib has both encoders.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
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

/** Writes `<file>.br` and `<file>.gz` for every compressible file under `dir`; returns how many files it did. */
export function precompressDir(dir: string): number {
  let n = 0
  for (const file of walk(dir)) {
    if (!PRECOMPRESS_EXTENSIONS.includes(extname(file))) continue
    const bytes = readFileSync(file)
    if (bytes.length < PRECOMPRESS_MIN_BYTES) continue
    writeFileSync(`${file}.br`, brotliCompressSync(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      },
    }))
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
        const n = precompressDir(join(config.root, config.build.outDir))
        config.logger.info(`precompress: ${n} files → .br + .gz`)
      },
    },
  }
}
