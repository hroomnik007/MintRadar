import type { Request, Response, NextFunction } from 'express'

// Readiness gate. The port opens early (app.listen runs first), but initDb() and the seed step are still running
// then, and a request that reaches the database mid-DDL competes with start-up for the pool (max 5 connections).
// Until both have finished, every database-dependent route answers 503 {"error":"starting"} with Retry-After: 2.
// The gate opens once and is never closed again. Under test (NODE_ENV=test) nothing runs the start-up block, so the
// gate starts open and existing tests are unaffected; readiness.test.ts closes it explicitly.
let ready = process.env['NODE_ENV'] === 'test'

export function isReady(): boolean {
  return ready
}

// Test hook only: the production code path is openGateAfter().
export function setReadyForTests(value: boolean): void {
  ready = value
}

// Paths that never touch the database and stay reachable during start-up. /health is routed before this check is
// reached for /api/v1/health too (the /api/v1 rewrite has already run). Everything else under /api/ is gated, and so
// is /sitemap.xml (it reads the mints table).
const UNGATED_PATHS = new Set(['/health', '/api/og/page', '/api/nip05/verify'])

function needsDatabase(path: string): boolean {
  if (UNGATED_PATHS.has(path)) return false
  return path.startsWith('/api/') || path === '/sitemap.xml'
}

export function readinessGate(req: Request, res: Response, next: NextFunction): void {
  if (ready || !needsDatabase(req.path)) {
    next()
    return
  }
  res.setHeader('Retry-After', '2')
  res.status(503).json({ error: 'starting' })
}

// Runs the database start-up work and opens the gate only after it has resolved. A rejection leaves the gate closed
// and is passed on to the caller (index.ts logs it and exits).
export function openGateAfter(startup: () => Promise<unknown>): Promise<void> {
  return startup().then(() => { ready = true })
}
