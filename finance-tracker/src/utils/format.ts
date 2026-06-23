export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('sk-SK', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(dateStr))
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}
