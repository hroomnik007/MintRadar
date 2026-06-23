import { useMemo } from 'react'
import type { Category, VariableExpense, FixedExpense, BudgetStatus } from '../types'

interface UseBudgetStatusParams {
  categories: Category[]
  variableExpenses: VariableExpense[]
  fixedExpenses?: FixedExpense[]
}

export function useBudgetStatus({ categories, variableExpenses, fixedExpenses = [] }: UseBudgetStatusParams): BudgetStatus[] {
  return useMemo(() =>
    categories
      .filter(c => c.budgetLimit !== undefined && c.budgetLimit > 0)
      .map(cat => {
        const varSpent = variableExpenses
          .filter(e => e.categoryId === cat.id)
          .reduce((sum, e) => sum + e.amount, 0)
        const fixedSpent = fixedExpenses
          .filter(f => f.categoryId === cat.id)
          .reduce((sum, f) => sum + f.amount, 0)
        const spent = varSpent + fixedSpent
        const limit = cat.budgetLimit!
        const percentage = (spent / limit) * 100
        return {
          categoryId: cat.id!,
          categoryName: cat.name,
          categoryIcon: cat.icon,
          categoryColor: cat.color,
          spent,
          limit,
          percentage,
          isWarning: percentage >= 70 && percentage < 90,
          isOver: percentage >= 100,
        }
      }),
  [categories, variableExpenses, fixedExpenses])
}
