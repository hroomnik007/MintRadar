import { useEffect } from 'react'

const STORAGE_KEY = 'monthly_reminder_notified'
const SETTINGS_KEY = 'monthly_summary_enabled'

function isMonthlyReminderEnabled(): boolean {
  try {
    return localStorage.getItem(SETTINGS_KEY) === 'true'
  } catch {
    return false
  }
}

function getNotifiedDate(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function setNotifiedDate(date: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, date)
  } catch { /* ignore */ }
}

function isLastDayOfMonth(date: Date): boolean {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
  return date.getDate() === lastDay
}

export function useMonthlyReminderNotification(isAuthenticated = false) {
  useEffect(() => {
    if (!isAuthenticated) return
    if (!isMonthlyReminderEnabled()) return
    if (!('Notification' in window)) return

    const today = new Date()
    if (!isLastDayOfMonth(today)) return

    const todayStr = today.toISOString().split('T')[0]
    if (getNotifiedDate() === todayStr) return

    async function checkAndNotify() {
      let permission = Notification.permission
      if (permission === 'default') {
        permission = await Notification.requestPermission()
      }
      if (permission !== 'granted') return

      new Notification('Finvu — Mesačná pripomienka', {
        body: 'Skontroluj súhrn tohto mesiaca vo Finvu.',
        icon: '/logo.svg',
      })

      setNotifiedDate(todayStr)
    }

    checkAndNotify()
  }, [isAuthenticated])
}
