import { apiClient } from './client'
import type { ApiCategory } from '../types'

export interface CategoryPayload {
  name: string
  type: 'income' | 'expense'
  color?: string
  icon?: string
  budgetLimit?: number | null
  autoLimit?: boolean
}

export async function getCategories(): Promise<{ data: ApiCategory[] }> {
  const { data } = await apiClient.get('/api/categories')
  return data
}

export async function createCategory(
  payload: CategoryPayload
): Promise<{ data: ApiCategory }> {
  const { data } = await apiClient.post('/api/categories', payload)
  return data
}

export async function updateCategory(
  id: string,
  payload: Partial<Omit<CategoryPayload, 'type'>>
): Promise<{ data: ApiCategory }> {
  const { data } = await apiClient.put(`/api/categories/${id}`, payload)
  return data
}

export async function deleteCategory(id: string): Promise<void> {
  await apiClient.delete(`/api/categories/${id}`)
}

export async function deleteAllCategories(): Promise<void> {
  await apiClient.delete('/api/categories')
}

export async function reorderCategories(items: { id: string; order: number }[]): Promise<void> {
  await apiClient.patch('/api/categories/reorder', { items })
}
