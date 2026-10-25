// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { brotliDecompressSync, gunzipSync } from 'node:zlib'
import { precompressDir, PRECOMPRESS_MIN_BYTES } from '../../vite-precompress'

describe('precompressDir (build-time .br/.gz)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'precompress-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('writes .br and .gz that decompress to the original bytes, in subdirectories too', () => {
    mkdirSync(join(dir, 'assets'))
    const js = 'export const x = 1;\n'.repeat(200)
    writeFileSync(join(dir, 'assets', 'index-abc.js'), js)
    writeFileSync(join(dir, 'index.html'), '<!doctype html>' + '<p>hi</p>'.repeat(200))

    expect(precompressDir(dir)).toBe(2)

    const f = join(dir, 'assets', 'index-abc.js')
    expect(brotliDecompressSync(readFileSync(f + '.br')).toString()).toBe(js)
    expect(gunzipSync(readFileSync(f + '.gz')).toString()).toBe(js)
    expect(readFileSync(f + '.br').length).toBeLessThan(js.length)
    expect(existsSync(join(dir, 'index.html.br'))).toBe(true)
  })

  it('skips files under the nginx gzip_min_length and non-text types', () => {
    writeFileSync(join(dir, 'small.js'), 'x'.repeat(PRECOMPRESS_MIN_BYTES - 1))
    writeFileSync(join(dir, 'icon.png'), Buffer.alloc(4096, 1))
    writeFileSync(join(dir, 'font.woff2'), Buffer.alloc(4096, 1))

    expect(precompressDir(dir)).toBe(0)
    expect(existsSync(join(dir, 'small.js.br'))).toBe(false)
    expect(existsSync(join(dir, 'icon.png.br'))).toBe(false)
  })

  it('does not compress its own output again on a second run', () => {
    writeFileSync(join(dir, 'a.css'), 'a{color:red}\n'.repeat(200))
    precompressDir(dir)
    expect(precompressDir(dir)).toBe(1)
    expect(existsSync(join(dir, 'a.css.br.br'))).toBe(false)
  })
})
