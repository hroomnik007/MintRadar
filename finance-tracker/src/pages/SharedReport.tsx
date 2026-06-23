import { useState, useEffect } from 'react'
import { getSharedReport } from '../api/auth'
import { useTranslation } from '../i18n'

interface SharedReportProps {
  token: string
}

export function SharedReportPage({ token }: SharedReportProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSharedReport(token)
      .then(res => {
        try {
          setData(JSON.parse(res.data))
        } catch {
          setError(t.sharedReport.loadError)
        }
      })
      .catch(err => {
        const msg = err?.response?.data?.error ?? t.sharedReport.notFoundError
        setError(msg)
      })
      .finally(() => setLoading(false))
  }, [token])

  const formatAmount = (n: number) =>
    new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' }).format(n)

  if (loading) {
    return (
      <div style={{ minHeight: '100svh', background: '#0D0A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#9D84D4', fontSize: 15 }}>{t.sharedReport.loading}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100svh', background: '#0D0A1A', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
        <p style={{ fontSize: 40 }}>🔗</p>
        <p style={{ color: '#F87171', fontSize: 15, textAlign: 'center' }}>{error}</p>
        <a href="/" style={{ color: '#A78BFA', fontSize: 13 }}>{t.sharedReport.goToApp}</a>
      </div>
    )
  }

  const report = data as {
    title?: string
    month?: string
    totalIncome?: number
    totalExpenses?: number
    balance?: number
    byCategory?: { name: string; color: string; total: number; percentage: number }[]
    generatedAt?: string
  }

  return (
    <div style={{ minHeight: '100svh', background: '#0D0A1A', color: '#E2D9F3', padding: '32px 16px', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <p style={{ fontSize: 32, marginBottom: 8 }}>📊</p>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>{report.title ?? t.sharedReport.defaultTitle}</h1>
        {report.month && <p style={{ fontSize: 13, color: '#9D84D4', margin: 0 }}>{report.month}</p>}
      </div>

      <div style={{ background: '#2A1F4A', border: '0.5px solid #4C3A8A', borderRadius: 16, padding: 20, marginBottom: 12 }}>
        <p style={{ fontSize: 11, color: '#9D84D4', margin: '0 0 4px' }}>{t.nav.income}</p>
        <p style={{ fontSize: 24, fontWeight: 700, color: '#34D399', margin: 0, fontFamily: 'monospace' }}>+{formatAmount(report.totalIncome ?? 0)}</p>
      </div>

      <div style={{ background: '#2A1F4A', border: '0.5px solid #4C3A8A', borderRadius: 16, padding: 20, marginBottom: 12 }}>
        <p style={{ fontSize: 11, color: '#9D84D4', margin: '0 0 4px' }}>{t.nav.expenses}</p>
        <p style={{ fontSize: 24, fontWeight: 700, color: '#F87171', margin: 0, fontFamily: 'monospace' }}>-{formatAmount(report.totalExpenses ?? 0)}</p>
      </div>

      <div style={{ background: '#1E1535', border: '1px solid #4C3A8A', borderRadius: 16, padding: 20, marginBottom: 20 }}>
        <p style={{ fontSize: 11, color: '#9D84D4', margin: '0 0 4px' }}>{t.sharedReport.balance}</p>
        <p style={{ fontSize: 28, fontWeight: 700, color: (report.balance ?? 0) >= 0 ? '#34D399' : '#F87171', margin: 0, fontFamily: 'monospace' }}>
          {(report.balance ?? 0) >= 0 ? '+' : ''}{formatAmount(report.balance ?? 0)}
        </p>
      </div>

      {(report.byCategory ?? []).length > 0 && (
        <div style={{ background: '#2A1F4A', border: '0.5px solid #4C3A8A', borderRadius: 16, padding: 20, marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#9D84D4', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t.sharedReport.byCategory}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(report.byCategory ?? []).map((cat, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13 }}>{cat.name}</span>
                  <span style={{ fontSize: 13, fontFamily: 'monospace', color: '#F87171' }}>{formatAmount(cat.total)}</span>
                </div>
                <div style={{ background: '#1A1030', borderRadius: 4, height: 6 }}>
                  <div style={{ width: `${cat.percentage}%`, height: '100%', borderRadius: 4, background: cat.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p style={{ fontSize: 11, color: '#4C3A8A', textAlign: 'center' }}>
        {t.sharedReport.createdVia} <strong style={{ color: '#7C3AED' }}>{t.nav.appName}</strong>
        {report.generatedAt && ` · ${new Date(report.generatedAt).toLocaleDateString('sk-SK')}`}
      </p>
    </div>
  )
}
