import { useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { useAuthStore } from '@/stores/auth.store'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { useWatchlistSync } from '@/hooks/useWatchlistSync'
import { useFollowRecommendations } from '@/hooks/useFollowRecommendations'
import { initBunkerQR } from '@/core/nostr/client'
import { NavLogo } from './NavLogo'
import './AppShell.css'

const IcClose = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
    <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
  </svg>
)
const IcShield = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
    <path d="M7 1.5L2 3.5v3.5C2 9.8 4.2 12.3 7 13c2.8-.7 5-3.2 5-6V3.5L7 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    <polyline points="4.5,7 6.2,8.7 9.5,5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export function AppShell() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo(0, 0) }, [pathname])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const editable = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if (e.key === '/') {
        if (editable) return
        e.preventDefault()
        document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
      }
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('mintradar:escape'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useWatchlistSync()
  const profile = useAuthStore(state => state.profile)
  useFollowRecommendations(profile?.pubkey ?? null)
  const login = useAuthStore(state => state.login)
  const loginNsec = useAuthStore(state => state.loginNsec)
  const loginBunker = useAuthStore(state => state.loginBunker)
  const logout = useAuthStore(state => state.logout)
  const isLoading = useAuthStore(state => state.isLoading)
  const authError = useAuthStore(state => state.error)
  const watchlistCount = useWatchlistStore(state => state.mints.length)

  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginMethod, setLoginMethod] = useState<'nip07' | 'nsec' | 'amber'>('nip07')
  const [nsecInput, setNsecInput] = useState('')
  const [nsecError, setNsecError] = useState('')
  const [bunkerInput, setBunkerInput] = useState('')
  const [bunkerError, setBunkerError] = useState('')
  const [qrUri, setQrUri] = useState('')
  const qrCancelRef = useRef<(() => void) | null>(null)

  const [nip07Available, setNip07Available] = useState(false)
  useEffect(() => {
    const check = () => setNip07Available(typeof window !== 'undefined' && !!window.nostr)
    check()
    const timer = setTimeout(check, 500)
    return () => clearTimeout(timer)
  }, [])

  // Close modal on successful login
  useEffect(() => {
    if (profile !== null) setShowLoginModal(false)
  }, [profile])

  // Reset modal state on close
  useEffect(() => {
    if (!showLoginModal) {
      setNsecInput('')
      setNsecError('')
      setLoginMethod('nip07')
      setBunkerInput('')
      setBunkerError('')
      setQrUri('')
      qrCancelRef.current?.()
      qrCancelRef.current = null
    }
  }, [showLoginModal])

  // Close modal on Escape key
  useEffect(() => {
    if (!showLoginModal) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowLoginModal(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showLoginModal])

  // Allow any page to open the login modal via custom event
  useEffect(() => {
    const handler = () => setShowLoginModal(true)
    window.addEventListener('mintradar:open-login', handler)
    return () => window.removeEventListener('mintradar:open-login', handler)
  }, [])

  function handleLogout() {
    logout()
    useWatchlistStore.getState().resetInMemory()
  }

  function handleShowQR() {
    qrCancelRef.current?.()
    const { uri, loginPromise, cancel } = initBunkerQR()
    qrCancelRef.current = cancel
    setQrUri(uri)
    setBunkerError('')
    void loginPromise
      .then(p => { useAuthStore.setState({ profile: p, isLoading: false, error: null }) })
      .catch(err => {
        if (err instanceof Error && err.name !== 'AbortError') {
          setBunkerError(err.message || 'QR connection failed')
        }
      })
  }

  async function handleModalConnect() {
    if (loginMethod === 'nip07') {
      await login()
    } else if (loginMethod === 'nsec') {
      const trimmed = nsecInput.trim()
      if (!trimmed) { setNsecError('Please enter your nsec key'); return }
      setNsecInput('')
      await loginNsec(trimmed)
      if (useAuthStore.getState().error) {
        setNsecError(useAuthStore.getState().error ?? 'Login failed')
      }
    } else if (loginMethod === 'amber') {
      const trimmed = bunkerInput.trim()
      if (!trimmed) { setBunkerError('Please enter a bunker:// URI or NIP-05 identifier'); return }
      setBunkerError('')
      await loginBunker(trimmed)
      if (useAuthStore.getState().error) {
        setBunkerError(useAuthStore.getState().error ?? 'Connection failed')
      }
    }
  }

  return (
    <div className="app-shell">
      <nav className="navbar">
        <NavLink to="/" className="navbar-brand nav-logo">
          <NavLogo />
          <span>Mint<span style={{color:'var(--accent)'}}>Radar</span></span>
        </NavLink>

        <div style={{flex:1}}/>

        {/* Tab segment group */}
        <div className="navbar-tabs">
          <NavLink to="/" end className={({isActive}) => `nav-tab${isActive ? ' active' : ''}`}>
            Dashboard
          </NavLink>
          <NavLink to="/watchlist" className={({isActive}) => `nav-tab${isActive ? ' active' : ''}`}>
            Watchlist
            {profile !== null && watchlistCount > 0 && <span className="nav-tab-badge">{watchlistCount}</span>}
          </NavLink>
          <NavLink to="/stats" className={({isActive}) => `nav-tab${isActive ? ' active' : ''}`}>
            Stats
          </NavLink>
          <NavLink to="/tools" className={({isActive}) => `nav-tab${isActive ? ' active' : ''}`}>
            Tools
          </NavLink>
        </div>

        <div className="navbar-auth">
          {profile === null ? (
            <button type="button" className="navbar-login-btn" onClick={() => setShowLoginModal(true)}>
              ⚡ Login via Nostr
            </button>
          ) : (
            <>
              <div className="navbar-profile">
                {profile.picture !== undefined && (
                  <img src={profile.picture} alt=""
                    className="navbar-avatar"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                )}
                <span className="navbar-username">
                  {profile.name ?? `${profile.pubkey.slice(0,8)}...`}
                </span>
              </div>
              <button type="button" className="navbar-disconnect-btn" onClick={handleLogout}>
                Disconnect
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Nostr login modal */}
      {showLoginModal && (
        <div className="nostr-modal-overlay" onClick={() => setShowLoginModal(false)}>
          <div className="nostr-modal" onClick={e => e.stopPropagation()}>
            <div className="nostr-modal-header">
              <div className="nostr-modal-icon">⚡</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="nostr-modal-title">Connect with Nostr</div>
                <div className="nostr-modal-subtitle">MintRadar uses your Nostr identity to save watchlists and post reviews. No email, no password.</div>
              </div>
              <button type="button" className="nostr-modal-close" onClick={() => setShowLoginModal(false)}>
                <IcClose />
              </button>
            </div>

            <div className="nostr-modal-methods">
              {([
                { id: 'nip07', title: 'Nostr extension', desc: 'Sign in with Alby, nos2x or any NIP-07 signer' },
                { id: 'nsec', title: 'Nostr key (nsec)', desc: 'Paste a private key — stored only in this browser' },
                { id: 'amber', title: 'Amber / remote', desc: 'Connect via NIP-46 bunker or mobile Amber app' },
              ] as const).map(m => (
                <div
                  key={m.id}
                  className={`nostr-method-card${loginMethod === m.id ? ' selected' : ''}`}
                  onClick={() => setLoginMethod(m.id)}
                >
                  <div className="nostr-method-radio">
                    <div className={`nostr-radio-dot${loginMethod === m.id ? ' active' : ''}`} />
                  </div>
                  <div>
                    <div className="nostr-method-title">{m.title}</div>
                    <div className="nostr-method-desc">{m.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            {loginMethod === 'nsec' && (
              <div className="nostr-nsec-wrap">
                <div className="nostr-nsec-security-warn">
                  ⚠️ Security notice: Entering your nsec key in a browser is inherently risky. On desktop, we recommend using a NIP-07 extension (Alby, nos2x) instead — your key never leaves the extension. On mobile, only use nsec login on a trusted personal device with no suspicious apps installed.
                </div>
                <input
                  className="nostr-nsec-input"
                  type="password"
                  placeholder="nsec1... or 64-char hex private key"
                  value={nsecInput}
                  onChange={e => { setNsecInput(e.target.value); setNsecError('') }}
                  autoFocus
                />
                {nsecError && <div className="nostr-nsec-error">{nsecError}</div>}
              </div>
            )}

            {loginMethod === 'nip07' && !nip07Available && (
              <div className="nostr-warn">
                No Nostr extension detected.{' '}
                <a href="https://getalby.com" target="_blank" rel="noreferrer">Install Alby</a> or nos2x to continue.
              </div>
            )}

            {loginMethod === 'amber' && (
              <div className="nostr-amber-wrap">
                <input
                  className="nostr-nsec-input"
                  type="text"
                  placeholder="bunker://... or user@domain.com"
                  value={bunkerInput}
                  onChange={e => { setBunkerInput(e.target.value); setBunkerError('') }}
                  autoFocus
                />
                {bunkerError && <div className="nostr-nsec-error">{bunkerError}</div>}
                <div className="nostr-amber-qr-row">
                  <button type="button" className="nostr-qr-btn" onClick={handleShowQR}>
                    {qrUri ? 'Refresh QR' : 'Show QR for Amber'}
                  </button>
                  {qrUri && <span className="nostr-qr-hint">Scan with Amber on your phone</span>}
                </div>
                {qrUri && (
                  <div className="nostr-qr-wrap">
                    <QRCodeSVG value={qrUri} size={192} bgColor="#0d1117" fgColor="#e6edf3" />
                  </div>
                )}
                {isLoading && (
                  <div className="nostr-warn">Connecting to remote signer…</div>
                )}
              </div>
            )}

            {authError && loginMethod !== 'nsec' && loginMethod !== 'amber' && (
              <div className="nostr-auth-error">{authError}</div>
            )}

            <div className="nostr-modal-footer">
              <div className="nostr-privacy-note">
                <IcShield /> Your keys never leave your device. MintRadar only reads your public profile.
              </div>
              <div className="nostr-modal-actions">
                <button type="button" className="nostr-cancel-btn" onClick={() => setShowLoginModal(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="nostr-connect-btn"
                  disabled={
                    isLoading ||
                    (loginMethod === 'nip07' && !nip07Available) ||
                    (loginMethod === 'amber' && (!!qrUri || !bunkerInput.trim()))
                  }
                  onClick={() => { void handleModalConnect() }}
                >
                  {isLoading ? 'Connecting…' : <>⚡ Connect</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
