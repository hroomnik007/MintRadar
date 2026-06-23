import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { probeMint, type MintStatus } from '@core/mint/api'
import { db } from '@/db'

async function saveHistory(result: MintStatus): Promise<void> {
  await db.mintHistory.add({
    url: result.url,
    online: result.online,
    checkedAt: result.checkedAt,
    ...(result.latencyMs !== null ? { latencyMs: result.latencyMs } : {}),
  })
  const records = await db.mintHistory.where('url').equals(result.url).sortBy('checkedAt')
  if (records.length > 288) {
    const toDelete = records
      .slice(0, records.length - 288)
      .map(r => r.id)
      .filter((id): id is number => id !== undefined)
    await db.mintHistory.bulkDelete(toDelete)
  }
}

export function useMintProbe(url: string): UseQueryResult<MintStatus> {
  return useQuery({
    queryKey: ['mint', 'probe', url],
    queryFn: async () => {
      const result = await probeMint(url)
      try {
        await saveHistory(result)
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('[useMintProbe] history save failed:', err)
        }
      }
      return result
    },
    staleTime: 1000 * 60 * 2,
    refetchInterval: 2 * 60 * 1000,
    refetchIntervalInBackground: false,
    retry: 1,
    enabled: url.length > 0,
  })
}
