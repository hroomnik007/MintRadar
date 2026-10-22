// Publishes docs/openapi/wallets-v1.yaml at /docs/openapi/wallets-v1.yaml. The file in docs/ stays the only source:
// a build emits its exact bytes as an asset (nothing is copied into public/), and the dev server answers the same
// path with the same bytes, so neither returns the SPA shell for it. nginx serves the built file with
// Content-Type application/yaml (deploy/nginx.conf).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

export const OPENAPI_SOURCE = 'docs/openapi/wallets-v1.yaml'
export const OPENAPI_PUBLIC_PATH = '/docs/openapi/wallets-v1.yaml'

export function openApiAssetPlugin(root = process.cwd()): Plugin {
  const bytes = () => readFileSync(join(root, OPENAPI_SOURCE))
  return {
    name: 'mintradar-openapi-asset',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: OPENAPI_PUBLIC_PATH.slice(1), source: bytes() })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.method !== 'GET' && req.method !== 'HEAD') || (req.url ?? '').split('?')[0] !== OPENAPI_PUBLIC_PATH) {
          next()
          return
        }
        const body = bytes()
        res.setHeader('Content-Type', 'application/yaml')
        res.setHeader('Content-Length', String(body.length))
        res.end(req.method === 'HEAD' ? undefined : body)
      })
    },
  }
}
