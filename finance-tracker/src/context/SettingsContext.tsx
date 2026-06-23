import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from 'react'
import { DEFAULT_SETTINGS } from '../types'
import type { AppSettings } from '../types'

const SETTINGS_KEY = 'app_settings'
const SUPPORTED_LANGS = ['sk', 'cs', 'pl', 'hu', 'en']

function detectBrowserLanguage(): string {
  try {
    const lang = (navigator.language || 'en').split('-')[0].toLowerCase()
    return SUPPORTED_LANGS.includes(lang) ? lang : 'en'
  } catch {
    return 'en'
  }
}

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const stored = raw ? JSON.parse(raw) : null
    const settings: AppSettings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
    if (!settings.language) {
      settings.language = detectBrowserLanguage()
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* ignore */ }
    }
    return settings
  } catch {
    const settings = { ...DEFAULT_SETTINGS, language: detectBrowserLanguage() }
    return settings
  }
}

function persistSettings(s: AppSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

interface SettingsContextValue {
  settings: AppSettings
  refreshSettings: () => Promise<void>
  updateSettings: (partial: Partial<AppSettings>) => void
  profileName: string
  profileAvatar: string
  setProfile: (name: string, avatar: string) => void
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  refreshSettings: async () => {},
  updateSettings: () => {},
  profileName: '',
  profileAvatar: '👤',
  setProfile: () => {},
})

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())

  const [profileName, setProfileName] = useState<string>(
    () => localStorage.getItem('profile_name') ?? ''
  )
  const [profileAvatar, setProfileAvatar] = useState<string>(
    () => localStorage.getItem('profile_avatar') ?? '👤'
  )

  useEffect(() => {
    const handler = () => setSettings(loadSettings())
    window.addEventListener('settings:language-changed', handler)
    return () => window.removeEventListener('settings:language-changed', handler)
  }, [])

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...partial }
      persistSettings(next)
      return next
    })
  }, [])

  const refreshSettings = useCallback(async () => {
    setSettings(loadSettings())
  }, [])

  const setProfile = useCallback((name: string, avatar: string) => {
    localStorage.setItem('profile_name', name)
    localStorage.setItem('profile_avatar', avatar)
    setProfileName(name)
    setProfileAvatar(avatar)
  }, [])

  const contextValue = useMemo(() => ({
    settings,
    refreshSettings,
    updateSettings,
    profileName,
    profileAvatar,
    setProfile,
  }), [settings, refreshSettings, updateSettings, profileName, profileAvatar, setProfile])

  return (
    <SettingsContext.Provider value={contextValue}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettingsContext() {
  return useContext(SettingsContext)
}

export function applyLanguageSetting(lang: string) {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    const settings = raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS }
    settings.language = lang
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch { /* ignore */ }
  window.dispatchEvent(new Event('settings:language-changed'))
}
