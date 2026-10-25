import { useQuery } from '@tanstack/react-query'
import { parseMintChanges, type MintChangesData } from '@/utils/mintChangeLog'

// The confirmed changes, pending values and keyset seen dates of ONE mint, read from OUR backend (/api/mints/changes).
// Mint Detail shows them as dates next to the data (keysets, fees, mint info). A failed request is an error, never "no changes":
// the page then simply shows no dates.
export function useMintChanges(url: string, enabled = true) {
  return useQuery<MintChangesData>({
    queryKey: ['mint', 'changes', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/changes?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('Failed to fetch the mint changes')
      const parsed = parseMintChanges(await res.json())
      if (parsed === null) throw new Error('Unexpected mint changes answer')
      return parsed
    },
    enabled,
    staleTime: 60 * 1000,
  })
}
