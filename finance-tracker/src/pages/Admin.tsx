import { useState, useEffect } from 'react'
import { AdminLoginPage } from './AdminLogin'
import {
  getAdminToken, clearAdminToken,
  fetchAdminStats, fetchAdminUsers,
  type AdminStats, type AdminUser,
} from '../api/admin'

export function AdminPage() {
  useEffect(() => {
    document.title = 'Finvu Admin'
    return () => { document.title = 'Finvu' }
  }, [])

  const [hasToken, setHasToken] = useState(() => !!getAdminToken())
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasToken) return
    setLoading(true)
    setError(null)
    Promise.all([fetchAdminStats(), fetchAdminUsers()])
      .then(([s, u]) => {
        setStats(s)
        setUsers(u.users)
      })
      .catch((err) => {
        if (err?.response?.status === 401) {
          clearAdminToken()
          setHasToken(false)
        } else {
          setError('Nepodarilo sa načítať admin dáta.')
        }
      })
      .finally(() => setLoading(false))
  }, [hasToken])

  if (!hasToken) {
    return <AdminLoginPage onSuccess={() => setHasToken(true)} />
  }

  function handleLogout() {
    clearAdminToken()
    setHasToken(false)
    setStats(null)
    setUsers([])
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100svh', background: '#0D0A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#9D84D4', fontSize: 16 }}>Načítavam...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100svh', background: '#0D0A1A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#f87171', fontSize: 16 }}>{error}</p>
      </div>
    )
  }

  const statCards = stats ? [
    { label: 'Celkom používateľov', value: stats.totalUsers, color: '#A78BFA', emoji: '👥' },
    { label: 'Noví (7 dní)', value: stats.newUsers7d, color: '#34D399', emoji: '🆕' },
    { label: 'Celkom transakcií', value: stats.totalTransactions, color: '#60A5FA', emoji: '💳' },
    { label: 'Aktívni (30 dní)', value: stats.activeUsers30d, color: '#F59E0B', emoji: '🔥' },
  ] : []

  return (
    <div style={{
      minHeight: '100svh',
      background: '#0D0A1A',
      color: '#E2D9F3',
      padding: '32px 24px',
    }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <img src="/logo.svg" alt="Finvu" style={{ width: 32, height: 32 }} />
              <span style={{ fontSize: 13, color: '#6B5A9E', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Finvu</span>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 700, color: '#E2D9F3' }}>Admin panel</h1>
            <p style={{ fontSize: 14, color: '#9D84D4', marginTop: 4 }}>Prehľad systémových štatistík</p>
          </div>
          <button
            onClick={handleLogout}
            style={{
              height: 40,
              padding: '0 20px',
              background: 'transparent',
              border: '1px solid #F87171',
              borderRadius: 12,
              color: '#F87171',
              fontSize: 14,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: 'pointer',
            }}
          >
            Odhlásiť
          </button>
        </div>

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
          {statCards.map(card => (
            <div key={card.label} style={{
              background: '#2A1F4A',
              border: '1px solid #4C3A8A',
              borderRadius: 20,
              padding: '20px 16px',
            }}>
              <p style={{ fontSize: 28, marginBottom: 8 }}>{card.emoji}</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: card.color, fontFamily: 'monospace' }}>
                {card.value.toLocaleString()}
              </p>
              <p style={{ fontSize: 12, color: '#9D84D4', marginTop: 4 }}>{card.label}</p>
            </div>
          ))}
        </div>

        {/* User table */}
        <div style={{
          background: '#2A1F4A',
          border: '1px solid #4C3A8A',
          borderRadius: 20,
          overflow: 'hidden',
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #4C3A8A' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: '#E2D9F3' }}>Používatelia ({users.length})</h2>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #4C3A8A' }}>
                  {['Meno', 'Email', 'Email overený', 'Registrácia', 'Posledné prihlásenie', 'Transakcie'].map(h => (
                    <th key={h} style={{ padding: '12px 16px', textAlign: 'left', color: '#9D84D4', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '12px 16px', color: '#E2D9F3', fontWeight: 500 }}>{u.name}</td>
                    <td style={{ padding: '12px 16px', color: '#B8A3E8' }}>{u.email}</td>
                    <td style={{ padding: '12px 16px', color: u.emailVerified ? '#34D399' : '#f87171' }}>
                      {u.emailVerified ? '✓' : '✗'}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#9D84D4' }}>
                      {new Date(u.createdAt).toLocaleDateString('sk-SK')}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#9D84D4' }}>
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('sk-SK') : '—'}
                    </td>
                    <td style={{ padding: '12px 16px', color: '#A78BFA', fontFamily: 'monospace', fontWeight: 600 }}>
                      {u.transactionCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
