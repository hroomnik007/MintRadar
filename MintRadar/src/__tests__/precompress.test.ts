// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { precompressDir, PRECOMPRESS_MIN_BYTES } from '../../vite-precompress'

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
