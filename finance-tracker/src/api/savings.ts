import { apiClient } from './client'
import type { ApiSavingsGoal, Deposit } from '../types'

export interface SavingsGoalPayload {
  name: string
  targetAmount: number
  savedAmount?: number
  deadline?: string | null
  icon?: string
  color?: string
  note?: string | null
}

export async function getSavingsGoals(): Promise<{ data: ApiSavingsGoal[] }> {
  const { data } = await apiClient.get('/api/savings')
  return data as { data: ApiSavingsGoal[] }
}

export async function createSavingsGoal(payload: SavingsGoalPayload): Promise<{ data: ApiSavingsGoal }> {
  const { data } = await apiClient.post('/api/savings', payload)
  return data as { data: ApiSavingsGoal }
}

export async function updateSavingsGoal(
  id: string,
  payload: Partial<SavingsGoalPayload>,
): Promise<{ data: ApiSavingsGoal }> {
  const { data } = await apiClient.patch(`/api/savings/${id}`, payload)
  return data as { data: ApiSavingsGoal }
}

export async function deleteSavingsGoal(id: string): Promise<void> {
  await apiClient.delete(`/api/savings/${id}`)
}

export async function pauseSavingsGoal(id: string): Promise<{ data: ApiSavingsGoal }> {
  const { data } = await apiClient.patch(`/api/savings/${id}/pause`)
  return data as { data: ApiSavingsGoal }
}

export async function resumeSavingsGoal(id: string): Promise<{ data: ApiSavingsGoal }> {
  const { data } = await apiClient.patch(`/api/savings/${id}/resume`)
  return data as { data: ApiSavingsGoal }
}

export async function listDeposits(goalId: string): Promise<Deposit[]> {
  const { data } = await apiClient.get(`/api/savings/${goalId}/deposits`)
  return (data as { data: Deposit[] }).data
}

export async function addDeposit(goalId: string, amount: number): Promise<{ goal: ApiSavingsGoal; deposit: Deposit }> {
  const { data } = await apiClient.post(`/api/savings/${goalId}/deposits`, { amount })
  return (data as { data: { goal: ApiSavingsGoal; deposit: Deposit } }).data
}

export async function deleteDeposit(goalId: string, depositId: string): Promise<ApiSavingsGoal> {
  const { data } = await apiClient.delete(`/api/savings/${goalId}/deposits/${depositId}`)
  return (data as { data: ApiSavingsGoal }).data
}
