import { useQuery } from '@tanstack/react-query'
import { parseMintChanges, type MintChangesData } from '@/utils/mintChangeLog'

// The mint change log of ONE mint, read from OUR backend (/api/mints/changes), lazily: only when the Change log panel is
// mounted (the Overview tab) and `enabled`. A failed request is an error, never an empty log.
export function useMintChanges(url: string, enabled = true) {
  return useQuery<MintChangesData>({
    queryKey: ['mint', 'changes', url],
    queryFn: async () => {
      const res = await fetch(`/api/mints/changes?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error('Failed to fetch the change log')
      const parsed = parseMintChanges(await res.json())
      if (parsed === null) throw new Error('Unexpected change log answer')
      return parsed
    },
    enabled,
    staleTime: 60 * 1000,
  })
}
