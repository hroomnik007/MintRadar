import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getTransactions, createTransaction, updateTransaction, deleteTransaction } from '../api/transactions'
import { useAuth } from '../context/AuthContext'
import type { Income, ApiTransaction } from '../types'

function adjustDateToMonth(originalDate: string, targetMonth: number, targetYear: number): string {
  const originalDay = parseInt(originalDate.split('-')[2], 10)
  const daysInTarget = new Date(targetYear, targetMonth, 0).getDate()
  const day = Math.min(originalDay, daysInTarget)
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function toIncome(t: ApiTransaction): Income {
  return {
    id: t.id,
    amount: t.amount,
    label: t.description ?? '',
    date: t.date,
    recurring: t.isFixed,
    created_by: t.created_by ?? null,
  }
}

export function incomeQueryKey(month: number | undefined, year: number | undefined, trackingStart: string | null | undefined) {
  const monthStr = month !== undefined && year !== undefined
    ? `${year}-${String(month).padStart(2, '0')}`
    : null
  return ['incomes', monthStr, trackingStart ?? null] as const
}

export async function fetchIncomes(
  month: number | undefined,
  year: number | undefined,
  trackingStart: string | null | undefined,
): Promise<Income[]> {
  try {
    const monthStr = month !== undefined && year !== undefined
      ? `${year}-${String(month).padStart(2, '0')}`
      : undefined
    const { data } = await getTransactions({ type: 'income', month: monthStr, limit: 200 })

    if (monthStr) {
      const trackingYM = trackingStart ? trackingStart.substring(0, 7) : null
      if (trackingYM && monthStr < trackingYM) {
        return data.filter(t => !t.isFixed).map(toIncome)
      }
      // No month filter here by design: a recurring income created in any past
      // month must appear in every subsequent month. The backend month param
      // filters by creation date, not recurrence — adding it would hide older
      // recurring incomes. Client-side filter on line below enforces t.date <= monthStr.
      // TODO: paginate if a user accumulates >200 recurring income records.
      const { data: recurring } = await getTransactions({ type: 'income', isFixed: true, limit: 200 })
      if (recurring.length === 200) {
        console.warn('useIncomes: recurring income limit reached, some records may be missing')
      }
      const existingIds = new Set(data.map(t => t.id))
      const extra = recurring
        .filter(t => {
          if (existingIds.has(t.id)) return false
          if (t.date.substring(0, 7) > monthStr) return false
          if (trackingYM && t.date.substring(0, 7) < trackingYM) return false
          return true
        })
        .map(t => t.date.substring(0, 7) !== monthStr
          ? { ...t, date: adjustDateToMonth(t.date, month!, year!) }
          : t
        )
      return [...data, ...extra].map(toIncome)
    }
    return data.map(toIncome)
  } catch {
    return []
  }
}

export function useIncomes(month?: number, year?: number) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const qKey = incomeQueryKey(month, year, user?.tracking_start_date)

  const { data: incomes = [] } = useQuery({
    queryKey: qKey,
    queryFn: () => fetchIncomes(month, year, user?.tracking_start_date),
    enabled: !!user,
  })

  const invalidate = useCallback(() =>
    qc.invalidateQueries({ queryKey: ['incomes'] }), [qc])

  const addIncome = useCallback(async (income: Omit<Income, 'id'>): Promise<void> => {
    await createTransaction({
      type: 'income',
      amount: income.amount,
      description: income.label,
      date: income.date,
      isFixed: income.recurring,
    })
    await invalidate()
  }, [invalidate])

  const updateIncome = useCallback(async (id: string, changes: Partial<Income>): Promise<void> => {
    await updateTransaction(id, {
      amount: changes.amount,
      description: changes.label,
      date: changes.date,
      isFixed: changes.recurring,
    })
    await invalidate()
  }, [invalidate])

  const deleteIncome = useCallback(async (id: string): Promise<void> => {
    await deleteTransaction(id)
    await invalidate()
  }, [invalidate])

  return { incomes, addIncome, updateIncome, deleteIncome }
}
