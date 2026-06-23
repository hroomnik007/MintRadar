import { DEFAULT_SETTINGS } from '../types'
import type { AppSettings } from '../types'

// @deprecated — use useSettingsContext() instead
export function useSettings(): AppSettings {
  return DEFAULT_SETTINGS
}

// @deprecated — use useSettingsContext().updateSettings() instead
export async function setSetting(_key: string, _value: string | number | boolean) {
  // no-op
}
