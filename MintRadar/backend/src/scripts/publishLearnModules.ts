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
// Options (see USAGE in learnPublishRunner.ts): --only=1,3,4 (module numbers), --relays=wss://a,wss://b (instead
// of LONGFORM_RELAYS, nostrService.ts), --delay=N (seconds between articles, default 15), --retry-delay=N (default
// 60), --no-retry. Every relay that does not accept an article is printed with its reason; after the last article
// the failed relays get the SAME signed event once more. Exit code 1 if a relay still failed, 2 for a bad option.
// Example, resend modules 1, 3 and 4 to relay.damus.io only:
//   npx tsx src/scripts/publishLearnModules.ts --only=1,3,4 --relays=wss://relay.damus.io --publish
//
// Requires NOTIFICATION_SERVICE_NSEC in the environment (same identity used
// for kind:0 service profile / DM notifications) — publishLongFormArticle()
// throws if it isn't set.

import { publishLongFormArticle, publishToRelays, LONGFORM_RELAYS } from '../nostrService.js'
import { findModulesDir, parseAllModules } from './learnModuleMarkdown.js'
import { parseArgs, runPublishLearn, UsageError, USAGE } from './learnPublishRunner.js'

async function main(): Promise<void> {
  let args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`[publish-learn] ${err.message}`)
      console.error(USAGE)
      process.exit(2)
    }
    throw err
  }

  const modulesDir = findModulesDir()
  const modules = parseAllModules(modulesDir)
  console.log(`[publish-learn] parsed ${modules.length} modules from ${modulesDir}`)

  const { stillFailed } = await runPublishLearn(args, modules, {
    publishArticle: (params, relays) => publishLongFormArticle(params, relays),
    republish: (relays, event) => publishToRelays(relays, event),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    log: line => console.log(line),
    defaultRelays: LONGFORM_RELAYS,
  })
  if (Object.keys(stillFailed).length > 0) process.exitCode = 1
}

main().catch(err => {
  if (err instanceof UsageError) {
    console.error(`[publish-learn] ${err.message}`)
    process.exit(2)
  }
  console.error('[publish-learn] failed:', err)
  process.exit(1)
})
