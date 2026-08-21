// One-time script: publish the 5 MintRadar Learn modules as NIP-23 long-form
// Nostr articles (kind:30023), identifiers "mintradar-learn-module-1"…"-5".
// Title and content are parsed directly from the same source-of-truth
// markdown draft used to build the in-app JSX modules
// (src/pages/learn/Module1.tsx…Module5.tsx).
//
// SAFETY: publishing to Nostr relays is public and effectively irreversible
// (relays may retain the event indefinitely). This script defaults to a dry
// run that only prints what it would publish. Nothing is sent to a relay
// unless you pass --publish explicitly:
//
//   npx tsx src/scripts/publishLearnModules.ts            # dry run (default)
//   npx tsx src/scripts/publishLearnModules.ts --publish  # actually publishes
//
// Requires NOTIFICATION_SERVICE_NSEC in the environment (same identity used
// for kind:0 service profile / DM notifications) — publishLongFormArticle()
// throws if it isn't set.

import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { publishLongFormArticle } from '../nostrService.js'

// The draft currently lives at the outer repo root rather than under
// MintRadar/docs/ (where the task description originally pointed) — checked
// in that order so this keeps working if the file is later moved to match
// the documented location.
const CANDIDATE_PATHS = [
  path.join(__dirname, '..', '..', '..', 'docs', 'learn-content-draft.md'),
  path.join(__dirname, '..', '..', '..', '..', 'learn-content-draft.md'),
  path.join(__dirname, '..', '..', '..', '..', 'docs', 'learn-content-draft.md'),
]

interface ParsedModule {
  order: number
  title: string
  content: string
}

function findContentFile(): string {
  const override = process.env['LEARN_CONTENT_FILE']
  if (override) {
    if (!existsSync(override)) throw new Error(`LEARN_CONTENT_FILE set but not found: ${override}`)
    return override
  }
  for (const candidate of CANDIDATE_PATHS) {
    if (existsSync(candidate)) return candidate
  }
  throw new Error(
    `learn-content-draft.md not found in any candidate location:\n${CANDIDATE_PATHS.join('\n')}\n` +
    `Set LEARN_CONTENT_FILE to an explicit path instead.`
  )
}

function parseModules(raw: string): ParsedModule[] {
  const headerRe = /^## Module (\d+): (.+)$/gm
  const matches = [...raw.matchAll(headerRe)]
  if (matches.length === 0) throw new Error('No "## Module N: Title" headers found in content file')

  const modules: ParsedModule[] = []
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!
    const order = parseInt(m[1]!, 10)
    const title = m[2]!.trim()
    const start = m.index! + m[0].length
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : raw.length
    let content = raw.slice(start, end)
    // Strip the trailing "---" section separator and, on the last module,
    // the "*End of draft...*" review note — neither belongs in the article.
    content = content.replace(/\n-{3,}\s*$/, '').trim()
    content = content.replace(/\n\*End of draft[^*]*\*\s*$/i, '').trim()
    modules.push({ order, title, content })
  }
  return modules.sort((a, b) => a.order - b.order)
}

async function main(): Promise<void> {
  const shouldPublish = process.argv.includes('--publish')

  const filePath = findContentFile()
  const raw = readFileSync(filePath, 'utf-8')
  const modules = parseModules(raw)

  console.log(`[publish-learn] parsed ${modules.length} modules from ${filePath}`)
  console.log(shouldPublish ? '[publish-learn] mode: LIVE — publishing to relays' : '[publish-learn] mode: DRY RUN (pass --publish to actually send)')
  console.log('')

  for (const mod of modules) {
    const identifier = `mintradar-learn-module-${mod.order}`
    console.log(`--- ${identifier} ---`)
    console.log(`title: ${mod.title}`)
    console.log(`content: ${mod.content.length} chars`)

    if (!shouldPublish) continue

    const { succeeded, failed } = await publishLongFormArticle({
      identifier,
      title: mod.title,
      content: mod.content,
    })
    console.log(`published: ${succeeded} succeeded, ${failed} failed`)
  }

  console.log('')
  console.log(shouldPublish ? '[publish-learn] done' : '[publish-learn] dry run complete — re-run with --publish to send')
}

main().catch(err => {
  console.error('[publish-learn] failed:', err)
  process.exit(1)
})
