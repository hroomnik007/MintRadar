// docs/openapi/wallets-v1.yaml is the only source of the published OpenAPI file (vite-openapi.ts): a build emits its
// exact bytes at docs/openapi/wallets-v1.yaml, the dev server serves the same bytes. These tests run a tiny real
// Vite build into a temp dir (never the real dist) and call the dev middleware.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { build } from 'vite'
import { openApiAssetPlugin, OPENAPI_PUBLIC_PATH, OPENAPI_SOURCE } from '../../vite-openapi'

const ROOT = process.cwd()
const source = fs.readFileSync(path.join(ROOT, OPENAPI_SOURCE))

describe('openApiAssetPlugin', () => {
  it('emits one asset at docs/openapi/wallets-v1.yaml with the exact bytes of the source', () => {
    const emitted: { fileName: string; source: Uint8Array }[] = []
    const plugin = openApiAssetPlugin(ROOT)
    ;(plugin.generateBundle as (this: unknown) => void).call({ emitFile: (f: { fileName: string; source: Uint8Array }) => emitted.push(f) })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.fileName).toBe('docs/openapi/wallets-v1.yaml')
    expect(Buffer.compare(Buffer.from(emitted[0]!.source), source)).toBe(0)
  })

  it('a real build into a temp dir writes a byte-identical file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mintradar-openapi-'))
    try {
      fs.writeFileSync(path.join(tmp, 'main.js'), 'export default 1\n')
      await build({
        configFile: false,
        root: tmp,
        logLevel: 'silent',
        plugins: [openApiAssetPlugin(ROOT)],
        build: { outDir: path.join(tmp, 'out'), emptyOutDir: true, rollupOptions: { input: path.join(tmp, 'main.js') } },
      })
      const out = fs.readFileSync(path.join(tmp, 'out', 'docs', 'openapi', 'wallets-v1.yaml'))
      expect(Buffer.compare(out, source)).toBe(0)
      expect(out.subarray(0, 8).toString()).toBe('openapi:')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('the dev middleware answers the path with application/yaml and the same bytes, and passes other paths on', () => {
    let middleware: (req: unknown, res: unknown, next: () => void) => void = () => {}
    ;(openApiAssetPlugin(ROOT).configureServer as (s: unknown) => void)({ middlewares: { use: (fn: typeof middleware) => { middleware = fn } } })
    const run = (url: string, method = 'GET') => {
      const headers: Record<string, string> = {}
      let body: unknown
      let nexted = false
      middleware({ url, method }, { setHeader: (k: string, v: string) => { headers[k] = v }, end: (b: unknown) => { body = b } }, () => { nexted = true })
      return { headers, body, nexted }
    }
    const hit = run(`${OPENAPI_PUBLIC_PATH}?x=1`)
    expect(hit.nexted).toBe(false)
    expect(hit.headers['Content-Type']).toBe('application/yaml')
    expect(Buffer.compare(hit.body as Buffer, source)).toBe(0)
    expect(run('/docs/other.yaml').nexted).toBe(true)
    expect(run(OPENAPI_PUBLIC_PATH, 'POST').nexted).toBe(true)
  })
})

describe('service worker', () => {
  it('never answers /docs/ or /llms.txt navigations with the app shell', () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8')
    const line = /navigateFallbackDenylist: \[(.*)\]/.exec(cfg)?.[1] ?? ''
    expect(line).toContain('/^\\/docs\\//')
    expect(line).toContain('/^\\/llms\\.txt$/')
    expect(line).toContain('/^\\/api\\//')
    expect(line).toContain('/^\\/\\.well-known\\//')
  })
})
