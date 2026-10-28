// The loop of publishLearnModules.ts with its dependencies passed in: argument parsing, module selection, the pause
// between articles and the one retry of failed relays. No Nostr import and no keys here; the script wires in the real
// publishLongFormArticle / publishToRelays, the tests pass fakes (no network, nothing signed).

import type { ParsedModule } from './learnModuleMarkdown.js'

export interface PublishArgs {
  publish: boolean
  print: boolean
  /** Module numbers to handle (--only=1,3,4), in the given order; null = all modules. */
  only: number[] | null
  /** Relays to publish to (--relays=wss://a,wss://b); null = the default long-form relay list. */
  relays: string[] | null
  /** Pause between two articles, in seconds (--delay=N). */
  delaySec: number
  /** Wait before the one retry of the failed relays, in seconds (--retry-delay=N). */
  retryDelaySec: number
  /** --no-retry: skip the retry. */
  retry: boolean
}

export const DEFAULT_DELAY_SEC = 15
export const DEFAULT_RETRY_DELAY_SEC = 60
export const MAX_DELAY_SEC = 600

export const USAGE = `usage: npx tsx src/scripts/publishLearnModules.ts [options]
  (no options)          dry run: list what would be published
  --print               dry run + full Markdown of each article
  --publish             publish (needs NOTIFICATION_SERVICE_NSEC)
  --only=1,3,4          only these module numbers
  --relays=wss://a,...  publish to these relays instead of the default long-form list
  --delay=15            seconds between two articles (default ${DEFAULT_DELAY_SEC})
  --retry-delay=60      seconds before the one retry of failed relays (default ${DEFAULT_RETRY_DELAY_SEC})
  --no-retry            do not retry failed relays`

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

function parseSeconds(flag: string, value: string): number {
  if (!/^\d+$/.test(value)) throw new UsageError(`${flag} must be a whole number of seconds, got "${value}"`)
  const n = Number(value)
  if (n > MAX_DELAY_SEC) throw new UsageError(`${flag} must be at most ${MAX_DELAY_SEC} seconds, got ${n}`)
  return n
}

export function parseOnly(value: string): number[] {
  const parts = value.split(',').map(p => p.trim())
  if (parts.length === 0 || parts.some(p => p === '')) throw new UsageError(`--only needs comma-separated module numbers, e.g. --only=1,3,4 (got "${value}")`)
  const nums: number[] = []
  for (const p of parts) {
    if (!/^[1-9]\d*$/.test(p)) throw new UsageError(`--only: "${p}" is not a module number (use e.g. --only=1,3,4)`)
    const n = Number(p)
    if (nums.includes(n)) throw new UsageError(`--only: module ${n} is listed twice`)
    nums.push(n)
  }
  return nums
}

export function parseRelays(value: string): string[] {
  const parts = value.split(',').map(p => p.trim())
  if (parts.some(p => p === '')) throw new UsageError(`--relays needs comma-separated wss:// URLs, e.g. --relays=wss://relay.damus.io (got "${value}")`)
  const relays: string[] = []
  for (const p of parts) {
    let url: URL
    try {
      url = new URL(p)
    } catch {
      throw new UsageError(`--relays: "${p}" is not a valid URL`)
    }
    if (url.protocol !== 'wss:') throw new UsageError(`--relays: "${p}" must start with wss://`)
    if (url.username || url.password) throw new UsageError(`--relays: "${p}" must not contain credentials`)
    if (url.search || url.hash) throw new UsageError(`--relays: "${p}" must not contain a query or fragment`)
    // Same form as the relay lists in nostrService.ts: no trailing slash for a bare host.
    const normalized = url.pathname === '/' ? `wss://${url.host}` : `wss://${url.host}${url.pathname}`
    if (relays.includes(normalized)) throw new UsageError(`--relays: ${normalized} is listed twice`)
    relays.push(normalized)
  }
  return relays
}

export function parseArgs(argv: readonly string[]): PublishArgs {
  const args: PublishArgs = {
    publish: false, print: false, only: null, relays: null,
    delaySec: DEFAULT_DELAY_SEC, retryDelaySec: DEFAULT_RETRY_DELAY_SEC, retry: true,
  }
  const seen = new Set<string>()
  for (const arg of argv) {
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const value = eq === -1 ? null : arg.slice(eq + 1)
    if (seen.has(flag)) throw new UsageError(`${flag} is given more than once`)
    seen.add(flag)
    const needValue = (): string => {
      if (value === null || value === '') throw new UsageError(`${flag} needs a value, e.g. ${flag}=…`)
      return value
    }
    const noValue = (): void => {
      if (value !== null) throw new UsageError(`${flag} takes no value`)
    }
    switch (flag) {
      case '--publish': noValue(); args.publish = true; break
      case '--print': noValue(); args.print = true; break
      case '--no-retry': noValue(); args.retry = false; break
      case '--only': args.only = parseOnly(needValue()); break
      case '--relays': args.relays = parseRelays(needValue()); break
      case '--delay': args.delaySec = parseSeconds(flag, needValue()); break
      case '--retry-delay': args.retryDelaySec = parseSeconds(flag, needValue()); break
      default: throw new UsageError(`unknown option "${arg}"`)
    }
  }
  return args
}

/** The modules to handle, in --only order; throws for a number that is not a module. */
export function selectModules(modules: readonly ParsedModule[], only: number[] | null): ParsedModule[] {
  if (only === null) return [...modules]
  const known = modules.map(m => m.order)
  return only.map(n => {
    const mod = modules.find(m => m.order === n)
    if (!mod) throw new UsageError(`--only: there is no module ${n} (modules: ${known.join(', ')})`)
    return mod
  })
}

export interface RelayResult { relay: string; ok: boolean; message: string }
export interface PublishOutcome { succeeded: number; failed: number; results: RelayResult[] }

export interface RunnerDeps<E> {
  /** Signs and publishes one article (publishLongFormArticle). */
  publishArticle: (
    params: { identifier: string; title: string; summary: string; content: string },
    relays: readonly string[],
  ) => Promise<PublishOutcome & { event: E }>
  /** Sends the same signed event again (publishToRelays). */
  republish: (relays: readonly string[], event: E) => Promise<PublishOutcome>
  sleep: (ms: number) => Promise<void>
  log: (line: string) => void
  defaultRelays: readonly string[]
}

export interface RunSummary {
  /** identifier → relays that still failed after the retry. */
  stillFailed: Record<string, string[]>
}

export function moduleIdentifier(order: number): string {
  return `mintradar-learn-module-${order}`
}

function failedLines(results: readonly RelayResult[]): string[] {
  return results.filter(r => !r.ok).map(r => `  ✗ ${r.relay} — ${r.message}`)
}

export async function runPublishLearn<E>(args: PublishArgs, allModules: readonly ParsedModule[], deps: RunnerDeps<E>): Promise<RunSummary> {
  const modules = selectModules(allModules, args.only)
  const relays = args.relays ?? [...deps.defaultRelays]
  const { log } = deps

  log(args.publish ? '[publish-learn] mode: LIVE — publishing to relays' : '[publish-learn] mode: DRY RUN (pass --publish to actually send)')
  log(`[publish-learn] modules: ${modules.map(m => m.order).join(', ')}`)
  log(`[publish-learn] relays: ${relays.join(', ')}`)
  if (args.publish) log(`[publish-learn] ${args.delaySec}s between articles, ${args.retry ? `one retry of failed relays after ${args.retryDelaySec}s` : 'no retry'}`)
  log('')

  const pending: Array<{ identifier: string; event: E; relays: string[] }> = []
  for (const [i, mod] of modules.entries()) {
    const identifier = moduleIdentifier(mod.order)
    log(`--- ${identifier} ---`)
    log(`title: ${mod.title}`)
    log(`summary: ${mod.summary}`)
    log(`content: ${mod.content.length} chars`)
    if (args.print) {
      log('')
      log(mod.content)
      log('')
    }
    if (!args.publish) continue

    // Relays rate-limit writes per IP (relay.damus.io rejected 3 of 5 articles sent a second apart on 2026-10-28).
    if (i > 0 && args.delaySec > 0) await deps.sleep(args.delaySec * 1000)
    const out = await deps.publishArticle({ identifier, title: mod.title, summary: mod.summary, content: mod.content }, relays)
    log(`published: ${out.succeeded} succeeded, ${out.failed} failed`)
    for (const line of failedLines(out.results)) log(line)
    const failed = out.results.filter(r => !r.ok).map(r => r.relay)
    if (failed.length > 0) pending.push({ identifier, event: out.event, relays: failed })
  }

  const stillFailed: Record<string, string[]> = {}
  if (args.publish && pending.length > 0) {
    if (!args.retry) {
      for (const p of pending) stillFailed[p.identifier] = p.relays
    } else {
      log('')
      log(`[publish-learn] retrying ${pending.length} article(s) on their failed relays in ${args.retryDelaySec}s (same signed events)`)
      for (const [i, p] of pending.entries()) {
        await deps.sleep((i === 0 ? args.retryDelaySec : args.delaySec) * 1000)
        const out = await deps.republish(p.relays, p.event)
        log(`retry ${p.identifier}: ${out.succeeded} succeeded, ${out.failed} failed`)
        for (const line of failedLines(out.results)) log(line)
        const failed = out.results.filter(r => !r.ok).map(r => r.relay)
        if (failed.length > 0) stillFailed[p.identifier] = failed
      }
    }
  }

  log('')
  if (!args.publish) {
    log('[publish-learn] dry run complete — re-run with --publish to send')
  } else if (Object.keys(stillFailed).length === 0) {
    log('[publish-learn] done — every article is on every relay')
  } else {
    log('[publish-learn] done, but some relays did not take an article:')
    for (const [id, rs] of Object.entries(stillFailed)) log(`  ${id}: ${rs.join(', ')}`)
  }
  return { stillFailed }
}
