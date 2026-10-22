import { test, expect } from '@playwright/test'

// The OpenAPI file of the Wallet API is published from docs/openapi/wallets-v1.yaml (vite-openapi.ts). The dev server must
// answer with the file, not with the single-page-app shell; nginx does the same for the build (deploy/nginx.conf).
test('/docs/openapi/wallets-v1.yaml is the OpenAPI file, not the app shell', async ({ request }) => {
  const res = await request.get('/docs/openapi/wallets-v1.yaml')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type'] ?? '').not.toContain('text/html')
  expect(res.headers()['content-type']).toContain('yaml')
  const body = await res.text()
  expect(body.startsWith('openapi:')).toBe(true)
  expect(body).not.toContain('<!doctype html')
})

test('/llms.txt is the Markdown file, not the app shell', async ({ request }) => {
  const res = await request.get('/llms.txt')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type'] ?? '').not.toContain('text/html')
  expect((await res.text()).startsWith('# MintRadar')).toBe(true)
})
