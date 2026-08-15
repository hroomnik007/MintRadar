import cron from 'node-cron'
import pLimit from 'p-limit'
import { getKnownMints, probeMintToDb, pruneOldHistory, pruneUnvalidatedMints, backfillServerLocations } from './prober.js'
import { discoverMintsFromNostr, discoverMintsFromApi } from './discovery.js'
import { pruneOldNotificationSubscriptions } from './db.js'
import { publishServiceProfile } from './nostrService.js'

const KNOWN_MINTS = [
  'https://mint.minibits.cash/Bitcoin',
  'https://stablenut.umint.cash',
  'https://mint.coinos.io',
  'https://legend.lnbits.com/cashu/api/v1/4gr9Xcmz3XEkUNwiBiQGoC',
  'https://mint.lnwallet.app/cashu',
  'https://cashu.mutinywallet.com',
  'https://mint.macadamia.cash',
  'https://mint.cubo.cash',
  'https://testnut.cashu.space',
  'https://mint.swiss-enigma.ch/Bitcoin',
  'https://mint.plebs.tech/Bitcoin',
  'https://8333.space:3338',
  'https://mint.bananapeel.xyz',
  'https://mint.proxymana.ge/Bitcoin',
  'https://mint.laisee.org/Bitcoin',
  'https://mint.nerd.bet/Bitcoin',
  'https://mint.walletofsatoshi.com/Bitcoin',
  'https://npub.cash/Bitcoin',
]

export async function seedKnownMints(upsertMint: (url: string, name: undefined, isKnown: boolean) => Promise<void>): Promise<void> {
  for (const url of KNOWN_MINTS) {
    await upsertMint(url, undefined, true)
  }
}

export function startCron(): void {
  // Probe all known mints every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const mints = await getKnownMints()
      const limit = pLimit(10)
      await Promise.allSettled(mints.map(url => limit(() => probeMintToDb(url))))
    } catch (err) {
      if (process.env['NODE_ENV'] !== 'production') {
        console.error('[cron] probe error:', err)
      }
    }
  })

  // Prune old history every day at 3am
  cron.schedule('0 3 * * *', async () => {
    try {
      await pruneOldHistory()
    } catch (err) {
      if (process.env['NODE_ENV'] !== 'production') {
        console.error('[cron] prune error:', err)
      }
    }
  })

  // Prune mint candidates that never passed a validating probe, every day at 3:15am
  cron.schedule('15 3 * * *', async () => {
    try {
      const deleted = await pruneUnvalidatedMints()
      console.log(`[cron] pruned ${deleted} unvalidated mint candidate(s)`)
    } catch (err) {
      if (process.env['NODE_ENV'] !== 'production') {
        console.error('[cron] unvalidated mint prune error:', err)
      }
    }
  })

  // Prune notification subscriptions not updated in 30 days, every day at 3:30am
  cron.schedule('30 3 * * *', async () => {
    try {
      const deleted = await pruneOldNotificationSubscriptions()
      console.log(`[cron] pruned ${deleted} stale notification subscription(s)`)
    } catch (err) {
      if (process.env['NODE_ENV'] !== 'production') {
        console.error('[cron] notification subscription prune error:', err)
      }
    }
    // Cheap, idempotent replaceable event — safe to repeat daily, keeps the
    // service profile fresh on relays with short retention.
    await publishServiceProfile()
  })

  // Discovery: run once after 10s, then every 6h
  setTimeout(async () => {
    console.log('[cron] running initial discovery...')
    await discoverMintsFromNostr()
    await discoverMintsFromApi()
  }, 10_000)

  // Backfill server_location for mints that were never resolved (one-time catch-up)
  setTimeout(() => { void backfillServerLocations() }, 30_000)
  setInterval(async () => {
    console.log('[cron] running scheduled discovery...')
    await discoverMintsFromNostr()
    await discoverMintsFromApi()
  }, 6 * 60 * 60 * 1000)
}
