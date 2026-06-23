import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db'
import type { MintHistory } from '@/db'

export type MintHistoryRecord = MintHistory

export function useMintHistory(url: string): {
  records: MintHistoryRecord[]
  uptimePercent: number
  avgLatencyMs: number | null
} {
  const records = useLiveQuery(
    () => db.mintHistory.where('url').equals(url).sortBy('checkedAt'),
    [url],
    [] as MintHistoryRecord[]
  )

  const total = records.length
  const onlineRecords = records.filter(r => r.online)
  const uptimePercent =
    total === 0 ? 0 : Math.round((onlineRecords.length / total) * 1000) / 10

  const latencies = onlineRecords
    .map(r => r.latencyMs)
    .filter((l): l is number => l !== undefined)
  const avgLatencyMs =
    latencies.length === 0
      ? null
      : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)

  return { records, uptimePercent, avgLatencyMs }
}
