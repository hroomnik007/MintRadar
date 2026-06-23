import { useEffect } from 'react'
import type { BudgetStatus } from '../types'

const STORAGE_KEY = 'budget_warning_notified'
const SETTINGS_KEY = 'budget_warnings_enabled'
const WARNING_THRESHOLD = 80

function getNotifiedDates(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function setNotifiedDate(categoryId: string, date: string): void {
  const notified = getNotifiedDates()
  notified[categoryId] = date
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notified))
  } catch { /* ignore */ }
}

function isBudgetWarningsEnabled(): boolean {
  try {
    const val = localStorage.getItem(SETTINGS_KEY)
    return val === null ? true : val === 'true'
  } catch {
    return true
  }
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

export function useBudgetWarningNotifications(
  budgetStatuses: BudgetStatus[],
  isAuthenticated = false,
) {
  useEffect(() => {
    if (!isAuthenticated) return
    if (!isBudgetWarningsEnabled()) return
    if (!('Notification' in window)) return

    const todayStr = new Date().toISOString().split('T')[0]

    async function checkAndNotify() {
      let permission = Notification.permission
      if (permission === 'default') {
        permission = await Notification.requestPermission()
      }
      if (permission !== 'granted') return

      const notified = getNotifiedDates()

      for (const status of budgetStatuses) {
        if (status.percentage < WARNING_THRESHOLD) continue
        if (notified[status.categoryId] === todayStr) continue

        new Notification('Finvu — Upozornenie na rozpočet', {
          body: `Kategória "${status.categoryName}" dosiahla 80 % limitu (${formatAmount(status.spent)} € z ${formatAmount(status.limit)} €)`,
          icon: '/logo.svg',
        })

        setNotifiedDate(status.categoryId, todayStr)
      }
    }

    checkAndNotify()
  }, [budgetStatuses, isAuthenticated])
}
