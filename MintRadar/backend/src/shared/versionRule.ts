// ONE rule for software version labels and for the version part of the Reliability Score.
//
// The backend (prober.ts, index.ts, versionCatalog.ts) and the frontend (Stats, Mint Detail,
// Compare) all decide through classifyVersion() below; nothing else compares versions against a
// "latest". This file has no imports, so the frontend copy src/utils/versionRule.ts is
// byte-identical (code, comments aside); src/__tests__/sharedModules.test.ts fails when they drift.
//
// The rule (owner decision 2026-10-09):
//   - "latest"   = the newest STABLE version of the software family, and any higher version.
//   - "outdated" = two or more MINOR versions behind that newest stable version.
//   - everything else gets no label.
//   - A pre-release (rc, ...) counts as its base version for the distance and is never
//     "outdated" against a stable version of its own minor line; it is never labelled "latest".
//   - A fourth segment (0.20.3.1) is ignored for the distance and used only for ordering.
//   - Points (of the 15-point Reliability Score component): 0 or 1 minor behind = 15, 2 = 9, 3 = 6,
//     4 = 3, 5 or more (or a lower major) = 0. Unknown software, an unparsable version and a missing
//     version keep the points they always had (4, 5 and 0).
//
// Version strings come from the mints themselves (untrusted): they are cut to MAX_VERSION_LENGTH
// before any matching, and every pattern below is a bounded, linear-time one.

export interface LatestVersion { major: number; minor: number }
/** Canonical family ('nutshell', 'cdk') -> its latest version. */
export type LatestVersions = Record<string, LatestVersion>

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** Fourth segment (0.20.3.1): used for ordering only, null when absent. */
  segment4: number | null
  /** Pre-release suffix without the dash ("rc.3"), null for a stable version. */
  prerelease: string | null
}

export type VersionLabel = 'latest' | 'outdated' | null

export interface VersionClass {
  /** Canonical family ('nutshell' | 'cdk') or null for unknown software. */
  family: string | null
  parsed: ParsedVersion | null
  /** Minor versions behind the latest (0 = current or ahead, Infinity = a lower major); null when not comparable. */
  minorsBehind: number | null
  label: VersionLabel
  /** Points of the 15-point version component. */
  points: number
}

export const MAX_VERSION_LENGTH = 100
/** Points for software the app does not recognise (the neutral 2.5 of 10, scaled to 15). */
export const UNKNOWN_SOFTWARE_POINTS = 4
/** Points for a recognised software with a version number that cannot be read (3 of 10, scaled to 15). */
export const UNPARSABLE_VERSION_POINTS = 5
/** Points by minors behind: index = minors behind (0 and 1 both full), 5 or more = 0. */
const POINTS_BY_MINORS_BEHIND = [15, 15, 9, 6, 3] as const

// ── Parsing ─────────────────────────────────────────────────────────────────
const VERSION_RE = /^(\d{1,9})\.(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:-([0-9A-Za-z.-]{1,64}))?/

/** Splits a raw mint version string ("Nutshell/0.21.0") into its software name and version number. */
export function splitVersionString(v: string): { software: string; versionNumber: string } {
  const s = v.slice(0, MAX_VERSION_LENGTH)
  const slashIdx = s.indexOf('/')
  return slashIdx >= 0
    ? { software: s.slice(0, slashIdx), versionNumber: s.slice(slashIdx + 1) }
    : { software: s, versionNumber: '' }
}

/** Strips a leading "v" (GitHub tag convention, e.g. cdk's "v0.17.5") and any pre-release suffix. */
export function normalizeVersionNumber(v: string): string {
  return v.slice(0, MAX_VERSION_LENGTH).replace(/^v/i, '').replace(/-.*$/, '')
}

/** Parses "0.20.3", "v0.20", "0.20.3.1" or "0.18.0-rc.1"; null when there is no leading major.minor. */
export function parseVersion(versionNumber: string): ParsedVersion | null {
  const s = versionNumber.trim().slice(0, MAX_VERSION_LENGTH).replace(/^v/i, '')
  const m = VERSION_RE.exec(s)
  if (!m || m[1] === undefined || m[2] === undefined) return null
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: m[3] !== undefined ? parseInt(m[3], 10) : 0,
    segment4: m[4] !== undefined ? parseInt(m[4], 10) : null,
    prerelease: m[5] ?? null,
  }
}

/** major.minor.patch of a version number (the pre-release suffix and a fourth segment are dropped). */
export function parseMajorMinorPatch(
  versionNumber: string
): { major: number; minor: number; patch: number } | null {
  const p = parseVersion(versionNumber)
  return p ? { major: p.major, minor: p.minor, patch: p.patch } : null
}

// ── Software families ───────────────────────────────────────────────────────
// Matched case-insensitively but NOT by prefix: "Nutshell-CF" must not match "nutshell".
const SOFTWARE_ALIASES: Record<string, string> = {
  nutshell: 'nutshell',
  cdk: 'cdk',
  'cdk-mintd': 'cdk',
}

export function canonicalSoftwareName(software: string): string | null {
  return SOFTWARE_ALIASES[software.trim().toLowerCase()] ?? null
}

// ── Ordering ────────────────────────────────────────────────────────────────
/**
 * Compare two mint version numbers (the part after "Software/").
 * Returns >0 if `a` is newer than `b`, <0 if older, 0 if equal.
 * 0.20.3.1 is newer than 0.20.3; a stable version is newer than its own pre-releases
 * (0.18.1 > 0.18.1-rc.2 > 0.18.1-rc.1). An unreadable version sorts below every readable one.
 */
export function compareMintVersionNumbers(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (pa === null || pb === null) {
    if (pa === null && pb === null) return 0
    return pa === null ? -1 : 1
  }
  if (pa.major !== pb.major) return pa.major - pb.major
  if (pa.minor !== pb.minor) return pa.minor - pb.minor
  if (pa.patch !== pb.patch) return pa.patch - pb.patch
  const sa = pa.segment4 ?? 0
  const sb = pb.segment4 ?? 0
  if (sa !== sb) return sa - sb
  if (pa.prerelease === null && pb.prerelease === null) return 0
  if (pa.prerelease === null) return 1
  if (pb.prerelease === null) return -1
  return comparePrerelease(pa.prerelease, pb.prerelease)
}

function comparePrerelease(a: string, b: string): number {
  const as = a.split('.'), bs = b.split('.')
  const n = Math.max(as.length, bs.length)
  for (let i = 0; i < n; i++) {
    const ai = as[i], bi = bs[i]
    if (ai === undefined) return -1
    if (bi === undefined) return 1
    const an = /^\d+$/.test(ai) ? parseInt(ai, 10) : NaN
    const bn = /^\d+$/.test(bi) ? parseInt(bi, 10) : NaN
    if (!Number.isNaN(an) && !Number.isNaN(bn)) {
      if (an !== bn) return an - bn
      continue
    }
    if (!Number.isNaN(an) && Number.isNaN(bn)) return -1
    if (Number.isNaN(an) && !Number.isNaN(bn)) return 1
    if (ai !== bi) return ai < bi ? -1 : 1
  }
  return 0
}

// ── The rule ────────────────────────────────────────────────────────────────
/** Points of the 15-point component for a version that is `minorsBehind` minor versions behind the latest. */
export function pointsForMinorsBehind(minorsBehind: number): number {
  return POINTS_BY_MINORS_BEHIND[minorsBehind] ?? 0
}

/**
 * Classifies one version against its family's latest.
 * `software` is the name a mint reports ("Nutshell", "cdk-mintd"); `version` is the number part ("0.21.0",
 * "v0.20.3", "0.18.0-rc.1"). A `version` that still carries the "Software/" prefix is split first (its
 * software then wins). `version` null/undefined = the mint reports no version (0 points); an empty or
 * unreadable string = unparsable.
 */
export function classifyVersion(
  software: string | null | undefined,
  version: string | null | undefined,
  latest: LatestVersion | null | undefined,
): VersionClass {
  if (version === null || version === undefined) {
    return { family: null, parsed: null, minorsBehind: null, label: null, points: 0 }
  }
  let sw = software ?? ''
  let num = version
  if (num.includes('/')) {
    const s = splitVersionString(num)
    sw = s.software
    num = s.versionNumber
  }
  const family = canonicalSoftwareName(sw)
  if (family === null) {
    return { family: null, parsed: null, minorsBehind: null, label: null, points: UNKNOWN_SOFTWARE_POINTS }
  }
  const parsed = parseVersion(num)
  if (parsed === null) {
    return { family, parsed: null, minorsBehind: null, label: null, points: UNPARSABLE_VERSION_POINTS }
  }
  if (!latest) {
    // Known family but no "latest" at all (nothing in the catalog, no stable version seen): neutral, like unknown software.
    return { family, parsed, minorsBehind: null, label: null, points: UNKNOWN_SOFTWARE_POINTS }
  }
  const minorsBehind = parsed.major > latest.major
    ? 0
    : parsed.major < latest.major
      ? Infinity
      : Math.max(0, latest.minor - parsed.minor)
  const label: VersionLabel = minorsBehind >= 2 ? 'outdated' : minorsBehind === 0 && parsed.prerelease === null ? 'latest' : null
  return { family, parsed, minorsBehind, label, points: pointsForMinorsBehind(minorsBehind) }
}

/** classifyVersion() for a raw "Software/version" string and a family -> latest map. */
export function classifyMintVersion(
  version: string | null | undefined,
  latestVersions: LatestVersions | null | undefined,
): VersionClass {
  if (!version) return classifyVersion(null, null, null)
  const { software, versionNumber } = splitVersionString(version)
  const family = canonicalSoftwareName(software)
  return classifyVersion(software, versionNumber, family ? latestVersions?.[family] : undefined)
}

/** { family: latest } for one mint, from the latest value the API sent for its software. */
export function latestMapFor(
  version: string | null | undefined,
  latest: LatestVersion | null | undefined,
): LatestVersions | undefined {
  if (!version || !latest) return undefined
  const family = canonicalSoftwareName(splitVersionString(version).software)
  return family ? { [family]: latest } : undefined
}

/** A fallback "latest" must be reported by at least this many DISTINCT mints (one hostile mint must not move it). */
export const MIN_MINTS_FOR_FALLBACK_LATEST = 2

/**
 * Fallback for "latest" (used only when the GitHub release catalog has no value for a family): the highest STABLE
 * version, per family, that at least `minMints` DISTINCT mints report EXACTLY (same family, same major.minor.patch
 * and fourth segment; the software-name spelling ("cdk" / "cdk-mintd" / "Nutshell"), its case and a leading "v" do
 * not matter). `versions` holds ONE entry per mint (the mint's own reported version string). A family where no
 * version qualifies gets no entry: there is no latest for it. Mint versions are untrusted, which is why a single
 * mint reporting a made-up "0.99.0" changes nothing.
 */
export function newestStableByFamily(
  versions: Iterable<string | null | undefined>,
  minMints: number = MIN_MINTS_FOR_FALLBACK_LATEST,
): LatestVersions {
  const seen = new Map<string, { family: string; p: ParsedVersion; mints: number }>()
  for (const v of versions) {
    if (!v) continue
    const { software, versionNumber } = splitVersionString(v)
    const family = canonicalSoftwareName(software)
    const p = family ? parseVersion(versionNumber) : null
    if (!family || !p || p.prerelease !== null) continue
    const key = `${family}|${p.major}.${p.minor}.${p.patch}.${p.segment4 ?? 0}`
    const cur = seen.get(key)
    if (cur) cur.mints += 1
    else seen.set(key, { family, p, mints: 1 })
  }
  const best = new Map<string, ParsedVersion>()
  for (const { family, p, mints } of seen.values()) {
    if (mints < minMints) continue
    const cur = best.get(family)
    if (!cur || compareMintVersionNumbers(formatBase(p), formatBase(cur)) > 0) best.set(family, p)
  }
  const out: LatestVersions = {}
  for (const [family, p] of best) out[family] = { major: p.major, minor: p.minor }
  return out
}

function formatBase(p: ParsedVersion): string {
  return `${p.major}.${p.minor}.${p.patch}${p.segment4 !== null ? `.${p.segment4}` : ''}`
}
