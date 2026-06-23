import { apiClient } from './client'

export interface HouseholdMember {
  id: string
  name: string
  avatar_url: string | null
  joined_at: string | null
  is_owner: boolean
}

export interface HouseholdData {
  id: number
  name: string
  invite_code: string
  created_at: string | null
  members: HouseholdMember[]
}

export interface MonthlyStats {
  total_expenses: number
  total_income: number
  per_member: Array<{
    user_id: string
    name: string
    expenses: number
    income: number
  }>
}

export interface ActivityItem {
  type: 'expense' | 'income'
  amount: number
  description: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
}

export async function createHousehold(name: string): Promise<HouseholdData> {
  const { data } = await apiClient.post('/api/households', { name })
  return data as HouseholdData
}

export async function joinHousehold(invite_code: string): Promise<{ id: number; name: string; invite_code: string; member_count: number }> {
  const { data } = await apiClient.post('/api/households/join', { invite_code })
  return data as { id: number; name: string; invite_code: string; member_count: number }
}

export async function getMyHousehold(): Promise<HouseholdData> {
  const { data } = await apiClient.get('/api/households/me')
  return data as HouseholdData
}

export async function leaveHousehold(): Promise<{ success: boolean }> {
  const { data } = await apiClient.delete('/api/households/leave')
  return data as { success: boolean }
}

export async function toggleHousehold(enabled: boolean): Promise<{ household_enabled: boolean }> {
  const { data } = await apiClient.patch('/api/households/toggle', { enabled })
  return data as { household_enabled: boolean }
}

export async function getMonthlyStats(householdId: number): Promise<MonthlyStats> {
  const { data } = await apiClient.get(`/api/households/${householdId}/stats/monthly`)
  return data as MonthlyStats
}

export async function getActivity(householdId: number, limit = 10): Promise<ActivityItem[]> {
  const { data } = await apiClient.get(`/api/households/${householdId}/activity`, { params: { limit } })
  return data as ActivityItem[]
}
