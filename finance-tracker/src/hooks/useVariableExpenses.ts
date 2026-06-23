import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTransactions, createTransaction, updateTransaction, deleteTransaction } from '../api/transactions'
import type { VariableExpense, ApiTransaction } from '../types'

function toVariableExpense(t: ApiTransaction): VariableExpense {
  return {
    id: t.id,
    amount: t.amount,
    categoryId: t.categoryId ?? '',
    note: t.description ?? '',
    date: t.date,
    created_by: t.created_by ?? null,
  }
}

export function variableExpenseQueryKey(month: number | undefined, year: number | undefined) {
  const monthStr = month !== undefined && year !== undefined
    ? `${year}-${String(month).padStart(2, '0')}`
    : null
  return ['variableExpenses', monthStr] as const
}

export async function fetchVariableExpenses(month?: number, year?: number): Promise<VariableExpense[]> {
  try {
    const monthStr = month !== undefined && year !== undefined
      ? `${year}-${String(month).padStart(2, '0')}`
      : undefined
    const { data } = await getTransactions({ type: 'expense', isFixed: false, month: monthStr, limit: 200 })
    return data.map(toVariableExpense)
  } catch {
    return []
  }
}

export function useVariableExpenses(month?: number, year?: number) {
  const qc = useQueryClient()

  const { data: variableExpenses = [] } = useQuery({
    queryKey: variableExpenseQueryKey(month, year),
    queryFn: () => fetchVariableExpenses(month, year),
  })

  const invalidate = useCallback(() =>
    qc.invalidateQueries({ queryKey: ['variableExpenses'] }), [qc])

  const addVariableExpense = useCallback(async (expense: Omit<VariableExpense, 'id'>): Promise<void> => {
    await createTransaction({
      type: 'expense',
      amount: expense.amount,
      categoryId: expense.categoryId || null,
      description: expense.note,
      date: expense.date,
      isFixed: false,
    })
    await invalidate()
  }, [invalidate])

  const updateVariableExpense = useCallback(async (id: string, changes: Partial<VariableExpense>): Promise<void> => {
    await updateTransaction(id, {
      amount: changes.amount,
      categoryId: changes.categoryId ?? null,
      description: changes.note,
      date: changes.date,
    })
    await invalidate()
  }, [invalidate])

  const deleteVariableExpense = useCallback(async (id: string): Promise<void> => {
    await deleteTransaction(id)
    await invalidate()
  }, [invalidate])

  return { variableExpenses, addVariableExpense, updateVariableExpense, deleteVariableExpense }
}
