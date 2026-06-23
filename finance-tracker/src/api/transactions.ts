import { apiClient } from './client'
import type { ApiTransaction, ApiSummary } from '../types'

export interface TransactionParams {
  month?: string
  type?: 'income' | 'expense'
  isFixed?: boolean
  limit?: number
  offset?: number
}

export interface TransactionPayload {
  categoryId?: string | null
  type: 'income' | 'expense'
  amount: number
  description?: string
  date: string
  isFixed?: boolean
}

export async function getTransactions(
  params: TransactionParams = {}
): Promise<{ data: ApiTransaction[]; total: number }> {
  const query: Record<string, string> = {}
  if (params.month) query.month = params.month
  if (params.type) query.type = params.type
  if (params.isFixed !== undefined) query.isFixed = String(params.isFixed)
  if (params.limit !== undefined) query.limit = String(params.limit)
  if (params.offset !== undefined) query.offset = String(params.offset)

  const { data } = await apiClient.get('/api/transactions', { params: query })
  return data
}

export async function createTransaction(
  payload: TransactionPayload
): Promise<{ data: ApiTransaction }> {
  const { data } = await apiClient.post('/api/transactions', payload)
  return data
}

export async function updateTransaction(
  id: string,
  payload: Partial<TransactionPayload>
): Promise<{ data: ApiTransaction }> {
  const { data } = await apiClient.put(`/api/transactions/${id}`, payload)
  return data
}

export async function deleteTransaction(id: string): Promise<void> {
  await apiClient.delete(`/api/transactions/${id}`)
}

export async function getSummary(month: string): Promise<ApiSummary> {
  const { data } = await apiClient.get('/api/transactions/summary', { params: { month } })
  return data
}

export async function getTotalBalance(): Promise<{ totalIncome: number; totalExpenses: number; balance: number }> {
  const { data } = await apiClient.get('/api/reports/total-balance')
  return data
}

export async function getBalanceAtMonth(year: number, month: number): Promise<{ balance: number }> {
  const { data } = await apiClient.get('/api/transactions/balance-at-month', { params: { year, month } })
  return data
}

export async function getSummaryCards(year: number, month: number): Promise<{ balance: number; income: number; expenses: number; savingsRate: number }> {
  const { data } = await apiClient.get('/api/transactions/summary-cards', { params: { year, month } })
  return data
}
