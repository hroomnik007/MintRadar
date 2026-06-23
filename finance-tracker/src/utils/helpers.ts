export function fmt(n: number): string {
  return n.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

export function fmtShort(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace('.', ',') + ' k€'
  return fmt(n)
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}

export const MONTHS = [
  'Január', 'Február', 'Marec', 'Apríl', 'Máj', 'Jún',
  'Júl', 'August', 'September', 'Október', 'November', 'December',
]

export function getGreeting(): { text: string; emoji: string } {
  const h = new Date().getHours()
  if (h < 6)  return { text: 'Dobrú noc',    emoji: '🌙' }
  if (h < 12) return { text: 'Dobré ráno',   emoji: '☀️' }
  if (h < 18) return { text: 'Dobrý deň',    emoji: '👋' }
  return              { text: 'Dobrý večer',  emoji: '🌙' }
}
