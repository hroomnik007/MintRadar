import { useState } from 'react'
import { adminLogin } from '../api/auth'
import { setAdminToken } from '../api/admin'

interface AdminLoginPageProps {
  onSuccess: () => void
}

export function AdminLoginPage({ onSuccess }: AdminLoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { token } = await adminLogin(username, password)
      setAdminToken(token)
      onSuccess()
    } catch {
      setError('Nesprávne prihlasovacie údaje.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100svh',
      background: '#0D0A1A',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '380px',
        background: 'linear-gradient(135deg, #1E1535, #2D1F5E)',
        border: '1px solid #4C3A8A',
        borderRadius: '24px',
        padding: '36px 28px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🔐</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#E2D9F3', marginBottom: 6 }}>
            Admin panel
          </h1>
          <p style={{ fontSize: 13, color: '#9D84D4' }}>Finvu — Správca systému</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9D84D4', marginBottom: 6 }}>
              Používateľské meno
            </label>
            <input
              type="text"
              autoComplete="username"
              placeholder="Používateľské meno"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              style={{
                width: '100%',
                height: 48,
                padding: '0 14px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid #4C3A8A',
                borderRadius: 14,
                color: '#E2D9F3',
                fontSize: 15,
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={e => (e.target.style.borderColor = '#7C3AED')}
              onBlur={e => (e.target.style.borderColor = '#4C3A8A')}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9D84D4', marginBottom: 6 }}>
              Heslo
            </label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                height: 48,
                padding: '0 14px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid #4C3A8A',
                borderRadius: 14,
                color: '#E2D9F3',
                fontSize: 15,
                fontFamily: 'inherit',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              onFocus={e => (e.target.style.borderColor = '#7C3AED')}
              onBlur={e => (e.target.style.borderColor = '#4C3A8A')}
            />
          </div>

          {error && (
            <p style={{ fontSize: 13, color: '#F87171', textAlign: 'center' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              height: 48,
              background: loading ? '#32265A' : 'linear-gradient(135deg, #7C3AED, #6D28D9)',
              border: 'none',
              borderRadius: 14,
              color: 'white',
              fontSize: 15,
              fontWeight: 600,
              fontFamily: 'inherit',
              cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Prihlasovanie...' : 'Prihlásiť sa'}
          </button>
        </form>
      </div>
    </div>
  )
}
