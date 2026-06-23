import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMyHousehold } from '../api/households'
import { useAuth } from '../context/AuthContext'
import type { HouseholdData, HouseholdMember } from '../api/households'

export function householdQueryKey() {
  return ['household'] as const
}

export async function fetchHouseholdData(): Promise<HouseholdData | null> {
  try {
    return await getMyHousehold()
  } catch {
    return null
  }
}

export function useHousehold() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const enabled = !!(user?.household_enabled && user?.household_id)

  const { data: household = null } = useQuery({
    queryKey: householdQueryKey(),
    queryFn: fetchHouseholdData,
    enabled,
  })

  const members: HouseholdMember[] = household?.members ?? []

  const reload = useCallback(() =>
    qc.invalidateQueries({ queryKey: householdQueryKey() }), [qc])

  return { household, members, reload }
}
