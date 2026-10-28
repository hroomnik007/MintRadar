// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { ResolvedConfig } from 'vite'
import { precompressDir, precompressPlugin, PRECOMPRESS_MIN_BYTES } from '../../vite-precompress'

describe('precompressDir (build-time .gz for nginx gzip_static)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'precompress-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('writes a .gz (and no .br) that decompresses to the original bytes, in subdirectories too', () => {
    mkdirSync(join(dir, 'assets'))
    const js = 'export const x = 1;\n'.repeat(200)
    writeFileSync(join(dir, 'assets', 'index-abc.js'), js)
    writeFileSync(join(dir, 'index.html'), '<!doctype html>' + '<p>hi</p>'.repeat(200))

    expect(precompressDir(dir)).toBe(2)

    const f = join(dir, 'assets', 'index-abc.js')
    expect(gunzipSync(readFileSync(f + '.gz')).toString()).toBe(js)
    expect(readFileSync(f + '.gz').length).toBeLessThan(js.length)
    expect(existsSync(join(dir, 'index.html.gz'))).toBe(true)
    expect(existsSync(f + '.br')).toBe(false)
    expect(existsSync(join(dir, 'index.html.br'))).toBe(false)
  })

  it('skips files under the nginx gzip_min_length and non-text types', () => {
    writeFileSync(join(dir, 'small.js'), 'x'.repeat(PRECOMPRESS_MIN_BYTES - 1))
    writeFileSync(join(dir, 'icon.png'), Buffer.alloc(4096, 1))
    writeFileSync(join(dir, 'font.woff2'), Buffer.alloc(4096, 1))

    expect(precompressDir(dir)).toBe(0)
    expect(existsSync(join(dir, 'small.js.gz'))).toBe(false)
    expect(existsSync(join(dir, 'icon.png.gz'))).toBe(false)
  })

  it('does not compress its own output again on a second run', () => {
    writeFileSync(join(dir, 'a.css'), 'a{color:red}\n'.repeat(200))
    precompressDir(dir)
    expect(precompressDir(dir)).toBe(1)
    expect(existsSync(join(dir, 'a.css.gz.gz'))).toBe(false)
  })
})

// The plugin's closeBundle scans build.outDir resolved against the Vite root: a relative outDir (the deploy build's
// `dist`) lives under the root, an absolute one (a build into a temporary directory) must be used as it is.
describe('precompressPlugin: outDir resolution', () => {
  let root: string
  let abs: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'precompress-root-'))
    abs = mkdtempSync(join(tmpdir(), 'precompress-abs-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    rmSync(abs, { recursive: true, force: true })
  })

  function runPlugin(outDir: string): void {
    const plugin = precompressPlugin()
    const logged: string[] = []
    const config = { root, build: { outDir }, logger: { info: (m: string) => { logged.push(m) } } } as unknown as ResolvedConfig
    ;(plugin.configResolved as (c: ResolvedConfig) => void)(config)
    const hook = plugin.closeBundle as unknown as { handler: () => void }
    hook.handler()
    expect(logged).toEqual(['precompress: 1 files → .gz'])
  }

  it('a relative outDir is resolved against the Vite root', () => {
    mkdirSync(join(root, 'dist'))
    writeFileSync(join(root, 'dist', 'a.js'), 'export const x = 1;\n'.repeat(200))
    runPlugin('dist')
    expect(existsSync(join(root, 'dist', 'a.js.gz'))).toBe(true)
  })

  it('an absolute outDir (outside the root) is left alone, not joined onto the root', () => {
    writeFileSync(join(abs, 'a.js'), 'export const x = 1;\n'.repeat(200))
    runPlugin(abs)
    expect(existsSync(join(abs, 'a.js.gz'))).toBe(true)
  })
})
