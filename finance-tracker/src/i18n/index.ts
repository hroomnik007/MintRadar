import { sk, type Translations } from './sk'
import { en } from './en'
import { cs } from './cs'
import { pl } from './pl'
import { hu } from './hu'
import { useSettingsContext } from '../context/SettingsContext'

export { sk, en, cs, pl, hu }
export type { Translations }

const SUPPORTED_LANGS = ['sk', 'cs', 'pl', 'hu', 'en'] as const
export type SupportedLang = (typeof SUPPORTED_LANGS)[number]

const TRANSLATIONS: Record<SupportedLang, Translations> = { sk, cs, pl, hu, en }

export function useTranslation() {
  const { settings } = useSettingsContext()
  const lang = (SUPPORTED_LANGS as readonly string[]).includes(settings.language)
    ? (settings.language as SupportedLang)
    : 'en'
  return { t: TRANSLATIONS[lang] }
}
