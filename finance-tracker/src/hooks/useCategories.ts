import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getCategories, createCategory, updateCategory, deleteCategory } from '../api/categories'
import type { Category, ApiCategory } from '../types'

const BUDGET_LIMITS_KEY = 'category_budget_limits'

const LEGACY_ICON_MAP: Record<string, string> = {
  home: '🏠', utensils: '🍔', car: '🚗', heart: '💊',
  'gamepad-2': '🎉', shirt: '👕', 'circle-ellipsis': '📦',
  briefcase: '💰', clock: '⏱️', wallet: '💳', tag: '🏷️',
  'shopping-cart': '🛒', coffee: '☕', bus: '🚌', plane: '✈️',
}

function normalizeIcon(icon: string | null): string {
  if (!icon) return '📦'
  return LEGACY_ICON_MAP[icon] ?? icon
}

function loadBudgetLimits(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(BUDGET_LIMITS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function saveBudgetLimits(limits: Record<string, number>) {
  try { localStorage.setItem(BUDGET_LIMITS_KEY, JSON.stringify(limits)) } catch { /* ignore */ }
}

function toCategory(c: ApiCategory, limits: Record<string, number>): Category {
  return {
    id: c.id,
    name: c.name,
    color: c.color ?? '#9D84D4',
    icon: normalizeIcon(c.icon),
    type: c.type,
    // prefer server value; fall back to localStorage for backwards compatibility
    budgetLimit: c.budgetLimit != null ? c.budgetLimit : limits[c.id],
    autoLimit: c.autoLimit ?? false,
    hasFixedExpenses: c.hasFixedExpenses ?? false,
  }
}

export async function fetchCategoriesData(): Promise<Category[]> {
  try {
    const { data } = await getCategories()
    const limits = loadBudgetLimits()
    return data.map(c => toCategory(c, limits))
  } catch {
    return []
  }
}

export function useCategories() {
  const qc = useQueryClient()

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategoriesData,
  })

  const invalidate = useCallback(() =>
    qc.invalidateQueries({ queryKey: ['categories'] }), [qc])

  const addCategory = useCallback(async (category: Omit<Category, 'id'>): Promise<string> => {
    const limit = category.budgetLimit && category.budgetLimit > 0 ? category.budgetLimit : undefined
    const { data } = await createCategory({
      name: category.name,
      type: category.type ?? 'expense',
      color: category.color,
      icon: category.icon,
      budgetLimit: limit ?? null,
      autoLimit: category.autoLimit ?? true,
    })
    // mirror to localStorage as fallback
    if (limit !== undefined) {
      const limits = loadBudgetLimits()
      limits[data.id] = limit
      saveBudgetLimits(limits)
    }
    await invalidate()
    return data.id
  }, [invalidate])

  const updateCategoryFn = useCallback(async (id: string, changes: Partial<Category>): Promise<void> => {
    const apiChanges: { name?: string; color?: string; icon?: string; budgetLimit?: number | null; autoLimit?: boolean } = {}
    if (changes.name !== undefined) apiChanges.name = changes.name
    if (changes.color !== undefined) apiChanges.color = changes.color
    if (changes.icon !== undefined) apiChanges.icon = changes.icon
    if (changes.autoLimit !== undefined) apiChanges.autoLimit = changes.autoLimit
    if (changes.budgetLimit !== undefined) {
      apiChanges.budgetLimit = changes.budgetLimit > 0 ? changes.budgetLimit : null
      // mirror to localStorage as fallback
      const limits = loadBudgetLimits()
      if (changes.budgetLimit > 0) limits[id] = changes.budgetLimit
      else delete limits[id]
      saveBudgetLimits(limits)
    }
    if (Object.keys(apiChanges).length > 0) await updateCategory(id, apiChanges)
    await invalidate()
  }, [invalidate])

  const deleteCategoryFn = useCallback(async (id: string): Promise<void> => {
    await deleteCategory(id)
    const limits = loadBudgetLimits()
    delete limits[id]
    saveBudgetLimits(limits)
    await invalidate()
  }, [invalidate])

  return { categories, addCategory, updateCategory: updateCategoryFn, deleteCategory: deleteCategoryFn, reload: invalidate }
}
