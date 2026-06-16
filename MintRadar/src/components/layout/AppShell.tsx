import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'
import { useWatchlistStore } from '@/stores/watchlist.store'
import { useWatchlistSync } from '@/hooks/useWatchlistSync'
import { NavLogo } from './NavLogo'
import './AppShell.css'


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
  const login = useAuthStore(state => state.login)
  const logout = useAuthStore(state => state.logout)
  const isLoading = useAuthStore(state => state.isLoading)
  const watchlistCount = useWatchlistStore(state => state.mints.length)

  async function handleLogout() {
    logout()
    await useWatchlistStore.getState().clearWatchlist()
  }

  const [nip07Available, setNip07Available] = useState(false)

  useEffect(() => {
    const check = () => setNip07Available(typeof window !== 'undefined' && !!window.nostr)
    check()
    const timer = setTimeout(check, 500)
    return () => clearTimeout(timer)
  }, [])

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
            {watchlistCount > 0 && (
              <span className="nav-tab-badge">{watchlistCount}</span>
            )}
          </NavLink>
          <NavLink to="/stats" className={({isActive}) => `nav-tab${isActive ? ' active' : ''}`}>
            Stats
          </NavLink>
          <NavLink to="/nuts" className={({isActive}) => `nav-tab${isActive ? ' active' : ''}`}>
            NUTs
          </NavLink>
        </div>

        {/* Auth */}
        <div className="navbar-auth">
          {!nip07Available ? (
            <a href="https://getalby.com" target="_blank" rel="noreferrer" className="navbar-install-link">
              Install Nostr extension
            </a>
          ) : profile === null ? (
            <button type="button" className="navbar-auth-btn" onClick={() => { void login() }} disabled={isLoading}>
              {isLoading ? 'Connecting...' : 'Login with Nostr'}
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
              <button type="button" className="navbar-disconnect-btn" onClick={() => { void handleLogout() }}>
                Disconnect
              </button>
            </>
          )}
        </div>
      </nav>
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  )
}
