import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getSavingsGoals,
  createSavingsGoal,
  updateSavingsGoal,
  deleteSavingsGoal,
  pauseSavingsGoal as apiPause,
  resumeSavingsGoal as apiResume,
} from '../api/savings'
import type { SavingsGoal, ApiSavingsGoal } from '../types'

function toSavingsGoal(g: ApiSavingsGoal): SavingsGoal {
  return {
    id: g.id,
    name: g.name,
    targetAmount: g.targetAmount,
    savedAmount: g.savedAmount,
    deadline: g.deadline ?? null,
    icon: g.icon ?? undefined,
    color: g.color ?? undefined,
    note: g.note ?? undefined,
    paused: g.paused ?? false,
  }
}

export async function fetchSavingsData(): Promise<SavingsGoal[]> {
  try {
    const { data } = await getSavingsGoals()
    return data.map(toSavingsGoal)
  } catch {
    return []
  }
}

export function useSavings() {
  const qc = useQueryClient()

  const { data: goals = [] } = useQuery({
    queryKey: ['savings'],
    queryFn: fetchSavingsData,
  })

  const invalidate = useCallback(() =>
    qc.invalidateQueries({ queryKey: ['savings'] }), [qc])

  const addGoal = useCallback(async (goal: Omit<SavingsGoal, 'id'>): Promise<void> => {
    await createSavingsGoal({
      name: goal.name,
      targetAmount: goal.targetAmount,
      savedAmount: goal.savedAmount,
      deadline: goal.deadline ?? null,
      icon: goal.icon,
      color: goal.color,
      note: goal.note ?? null,
    })
    await invalidate()
  }, [invalidate])

  const updateGoal = useCallback(async (id: string, changes: Partial<SavingsGoal>): Promise<void> => {
    const payload: Record<string, unknown> = {}
    if (changes.name !== undefined) payload.name = changes.name
    if (changes.targetAmount !== undefined) payload.targetAmount = changes.targetAmount
    if (changes.savedAmount !== undefined) payload.savedAmount = changes.savedAmount
    if (changes.deadline !== undefined) payload.deadline = changes.deadline ?? null
    if (changes.icon !== undefined) payload.icon = changes.icon
    if (changes.color !== undefined) payload.color = changes.color
    if (changes.note !== undefined) payload.note = changes.note ?? null
    if (Object.keys(payload).length > 0) {
      await updateSavingsGoal(id, payload as Parameters<typeof updateSavingsGoal>[1])
    }
    await invalidate()
  }, [invalidate])

  const deleteGoal = useCallback(async (id: string): Promise<void> => {
    await deleteSavingsGoal(id)
    await invalidate()
  }, [invalidate])

  const pauseGoal = useCallback(async (id: string): Promise<void> => {
    await apiPause(id)
    await invalidate()
  }, [invalidate])

  const resumeGoal = useCallback(async (id: string): Promise<void> => {
    await apiResume(id)
    await invalidate()
  }, [invalidate])

  return { goals, addGoal, updateGoal, deleteGoal, pauseGoal, resumeGoal, reload: invalidate }
}
