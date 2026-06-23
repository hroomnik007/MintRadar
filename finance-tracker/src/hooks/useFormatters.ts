import { useSettingsContext } from '../context/SettingsContext'

export function useFormatters() {
  const { settings } = useSettingsContext()

  const formatAmount = (amount: number): string => {
    const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CZK: 'Kč' }
    const symbol = symbols[settings.currency] ?? settings.currency
    const normalized = Object.is(amount, -0) ? 0 : amount
    const rounded = parseFloat(normalized.toFixed(2))
    const abs = Math.abs(rounded)
    const sign = rounded < 0 ? '-' : ''
    const fmt = settings.currencyFormat ?? 'sk'
    if (fmt === 'en') {
      const intPart = Math.floor(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
      const decPart = (abs % 1).toFixed(2).slice(2)
      return `${sign}${symbol}${intPart}.${decPart}`
    }
    if (fmt === 'de') {
      const intPart = Math.floor(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
      const decPart = (abs % 1).toFixed(2).slice(2)
      return `${sign}${intPart},${decPart} ${symbol}`
    }
    const intPart = Math.floor(abs).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
    const decPart = (abs % 1).toFixed(2).slice(2)
    return `${sign}${intPart},${decPart} ${symbol}`
  }

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return ''
    try {
      const d = new Date(dateStr + 'T00:00:00')
      const day   = String(d.getDate()).padStart(2, '0')
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const year  = d.getFullYear()
      switch (settings.dateFormat) {
        case 'YYYY-MM-DD': return `${year}-${month}-${day}`
        case 'MM/DD/YYYY': return `${month}/${day}/${year}`
        default:           return `${day}.${month}.${year}`
      }
    } catch {
      return dateStr
    }
  }

  return { formatAmount, formatDate }
}
