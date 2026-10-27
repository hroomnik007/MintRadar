// One-time script: publish the 5 MintRadar Learn modules as NIP-23 long-form
// Nostr articles (kind:30023), identifiers "mintradar-learn-module-1"…"-5".
//
// Content is parsed directly from the live frontend source
// (../../../src/pages/learn/Module1.tsx…Module5.tsx) — NOT from a separate
// markdown draft. An earlier version of this script read
// learn-content-draft.md, but that file was a one-off snapshot that drifted
// out of sync with the JSX almost immediately (and has since been deleted).
// Parsing the .tsx directly means this script can never publish stale
// content — whatever's live in the app is what gets published.
//
// The Markdown conversion lives in learnModuleMarkdown.ts (pure: no Nostr, no keys), so it can be unit-tested and
// rendered without importing this script; see the vocabulary and the drift checks there.
//
// SAFETY: publishing to Nostr relays is public and effectively irreversible
// (relays may retain the event indefinitely). This script defaults to a dry
// run that only prints what it would publish. Nothing is sent to a relay
// unless you pass --publish explicitly:
//
//   npx tsx src/scripts/publishLearnModules.ts            # dry run (default)
//   npx tsx src/scripts/publishLearnModules.ts --print    # dry run + full converted Markdown, for review
//   npx tsx src/scripts/publishLearnModules.ts --publish  # actually publishes
//
// Requires NOTIFICATION_SERVICE_NSEC in the environment (same identity used
// for kind:0 service profile / DM notifications) — publishLongFormArticle()
// throws if it isn't set.

import { publishLongFormArticle } from '../nostrService.js'
import { findModulesDir, parseAllModules } from './learnModuleMarkdown.js'

async function main(): Promise<void> {
  const shouldPublish = process.argv.includes('--publish')
  const shouldPrint = process.argv.includes('--print')

  const modulesDir = findModulesDir()
  const modules = parseAllModules(modulesDir)

  console.log(`[publish-learn] parsed ${modules.length} modules from ${modulesDir}`)
  console.log(shouldPublish ? '[publish-learn] mode: LIVE — publishing to relays' : '[publish-learn] mode: DRY RUN (pass --publish to actually send)')
  console.log('')

  for (const mod of modules) {
    const identifier = `mintradar-learn-module-${mod.order}`
    console.log(`--- ${identifier} ---`)
    console.log(`title: ${mod.title}`)
    console.log(`summary: ${mod.summary}`)
    console.log(`content: ${mod.content.length} chars`)
    if (shouldPrint) {
      console.log('')
      console.log(mod.content)
      console.log('')
    }

    if (!shouldPublish) continue

    const { succeeded, failed } = await publishLongFormArticle({
      identifier,
      title: mod.title,
      summary: mod.summary,
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
