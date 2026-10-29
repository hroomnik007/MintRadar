// Dashboard software filter (?software=nutshell,cdk,other). Pure helpers, no React.
// A mint's software family is the part of its `version` string before "/" ("Nutshell/0.16.3", "cdk-mintd/0.9.1"),
// parsed by the same splitVersionString / canonicalSoftwareName the cards and the Reliability Score use. Families
// with at least MIN_MINTS_FOR_OPTION mints get their own option (today every family does, so "Other" only shows when it is
// selected in the URL); a mint without a version string is "Unknown". Multi-select, OR (like Unit): a mint passes if it belongs to at least one selected group.
import { splitVersionString, canonicalSoftwareName } from '@/utils/versionRule'

export const SOFTWARE_OTHER = 'other'
export const SOFTWARE_UNKNOWN = 'unknown'
/** A family needs this many mints (over all tracked mints) to be listed on its own. */
export const MIN_MINTS_FOR_OPTION = 1

const KEY_RE = /^[a-z0-9._-]{1,32}$/
/** Clean names for the families versionRule knows; any other family keeps the spelling mints report. */
const DISPLAY_NAMES: Record<string, string> = { nutshell: 'Nutshell', cdk: 'CDK-Mintd' }

type SoftwareMint = { version?: string | null }
export interface SoftwareFamily { key: string; name: string }

/** The family of a version string; null when there is none (null, empty, or nothing before the "/"). Case-insensitive. */
export function softwareFamily(version: string | null | undefined): SoftwareFamily | null {
  if (typeof version !== 'string') return null
  const raw = splitVersionString(version.trim()).software.trim()
  if (!raw) return null
  const canonical = canonicalSoftwareName(raw)
  const key = (canonical ?? raw.toLowerCase()).replace(/[^a-z0-9._-]/g, '-').slice(0, 32)
  return { key, name: (canonical && DISPLAY_NAMES[canonical]) || raw }
}

/** ?software=Nutshell,other → ['nutshell','other']. Malformed entries are dropped, duplicates collapse, order kept. */
export function parseSoftwareParam(raw: string | null): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const part of raw.split(',')) {
    const v = part.trim().toLowerCase()
    if (KEY_RE.test(v) && !out.includes(v)) out.push(v)
  }
  return out
}

/** Inverse of parseSoftwareParam; null when nothing is selected (the param is omitted). */
export function buildSoftwareParam(selected: readonly string[]): string | null {
  const n = parseSoftwareParam(selected.join(','))
  return n.length > 0 ? n.join(',') : null
}

export interface SoftwareOption { key: string; name: string }
export interface SoftwareGroups {
  /** Keys of the families that have their own option (≥ MIN_MINTS_FOR_OPTION mints). */
  families: ReadonlySet<string>
  /** Display order: families by mint count (then name), then Other, then Unknown. Empty groups are left out. */
  options: SoftwareOption[]
}

/** Groups the tracked mints into options. A selected key nobody has stays listed so it can be cleared. */
export function softwareGroups(mints: readonly SoftwareMint[], selected: readonly string[] = []): SoftwareGroups {
  const counts = new Map<string, { name: string; n: number }>()
  const spellings = new Map<string, Map<string, number>>()
  let unknown = 0
  for (const m of mints) {
    const f = softwareFamily(m.version)
    if (!f) { unknown++; continue }
    const c = counts.get(f.key) ?? { name: f.name, n: 0 }
    c.n++
    counts.set(f.key, c)
    const s = spellings.get(f.key) ?? new Map<string, number>()
    s.set(f.name, (s.get(f.name) ?? 0) + 1)
    spellings.set(f.key, s)
  }
  // One display spelling per family: the most reported one, ties alphabetical (stable whatever the order of the data).
  for (const [key, c] of counts) {
    c.name = [...(spellings.get(key) ?? [])].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? c.name
  }
  const families = new Set<string>()
  const listed: { key: string; name: string; n: number }[] = []
  let other = 0
  for (const [key, c] of counts) {
    if (c.n >= MIN_MINTS_FOR_OPTION) { families.add(key); listed.push({ key, name: c.name, n: c.n }) } else other += c.n
  }
  listed.sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1))
  const options: SoftwareOption[] = listed.map(({ key, name }) => ({ key, name }))
  if (other > 0 || selected.includes(SOFTWARE_OTHER)) options.push({ key: SOFTWARE_OTHER, name: 'Other' })
  if (unknown > 0 || selected.includes(SOFTWARE_UNKNOWN)) options.push({ key: SOFTWARE_UNKNOWN, name: 'Unknown' })
  for (const key of selected) {
    if (!options.some(o => o.key === key)) options.push({ key, name: key })
  }
  return { families, options }
}

/** No selection = no filtering; otherwise the mint's group (its own family, Other, or Unknown) must be selected. */
export function mintMatchesSoftware(mint: SoftwareMint, selected: readonly string[], families: ReadonlySet<string>): boolean {
  if (selected.length === 0) return true
  const f = softwareFamily(mint.version)
  if (!f) return selected.includes(SOFTWARE_UNKNOWN)
  return selected.includes(f.key) || (selected.includes(SOFTWARE_OTHER) && !families.has(f.key))
}
