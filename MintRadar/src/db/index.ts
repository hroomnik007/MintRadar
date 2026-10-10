import Dexie, { type Table } from 'dexie'

interface Mint {
  url: string
  name?: string
  addedAt: Date
  isPublic: boolean
}

interface MintHistory {
  id?: number
  url: string
  online: boolean
  latencyMs?: number
  checkedAt: Date
}

interface WatchlistEntry {
  url: string
  addedAt: Date
  notifyOnDown: boolean
  notifyOnUp: boolean
  // Set when the server last CONFIRMED these two flags (subscribe/unsubscribe answered ok).
  // Flags without it (rows from before this field existed, or never confirmed) are unconfirmed
  // and count as off everywhere — see utils/notifyState.ts.
  notifyConfirmedAt?: Date
  // "More alerts" flags (same confirmation rule as notifyOnDown/notifyOnUp: they count only while
  // notifyConfirmedAt is set). Optional: rows from before they existed simply read as off.
  notifyOnMintMeltIssues?: boolean
  notifyOnVersionOutdated?: boolean
  notifyOnNutLoss?: boolean
}

interface MetaEntry {
  key: string
  value: string
}

const db = new Dexie('mintradar-v1') as Dexie & {
  mints: Table<Mint, string>
  mintHistory: Table<MintHistory, number>
  watchlist: Table<WatchlistEntry, string>
  meta: Table<MetaEntry, string>
}

db.version(1).stores({
  mints: 'url, addedAt, isPublic',
  mintHistory: '++id, url, checkedAt',
  watchlist: 'url, addedAt',
})

db.version(2).stores({
  meta: 'key',
})

export { db }
export type { Mint, MintHistory, WatchlistEntry, MetaEntry }
