// Dashboard "Hide outdated software" filter (?outdated=hide). Pure helpers, no React. The ONE version rule decides:
// classifyMintVersion() in versionRule.ts with the `softwareLatest` the API sends per mint (the same call the Mint
// Detail pill and Compare make). "outdated" = OUTDATED_AFTER_MINORS (2) or more minor versions behind the newest stable
// release of the same family; nothing else is compared here. A mint whose version cannot be compared (unknown software
// such as Nutshell-CF or LekMint, no `softwareLatest`, an unreadable or missing version) is never hidden.
import { classifyMintVersion, latestMapFor, type LatestVersion } from '@/utils/versionRule'

type VersionedMint = { version?: string | null; softwareLatest?: LatestVersion | null }

export const OUTDATED_PARAM = 'outdated'
export const OUTDATED_PARAM_HIDE = 'hide'

/** ?outdated=hide → true; anything else (absent, other values) → false. */
export function parseOutdatedParam(raw: string | null): boolean {
  return raw === OUTDATED_PARAM_HIDE
}

/** Inverse of parseOutdatedParam: "hide" only when the filter is on, null (the param is omitted) otherwise. */
export function buildOutdatedParam(hideOutdated: boolean): string | null {
  return hideOutdated ? OUTDATED_PARAM_HIDE : null
}

/** The shared classification of one mint's version string against its family's latest. */
function classify(mint: VersionedMint) {
  return classifyMintVersion(mint.version, latestMapFor(mint.version, mint.softwareLatest))
}

/** True when the shared rule labels the mint's version "outdated". */
export function isOutdatedMint(mint: VersionedMint): boolean {
  return classify(mint).label === 'outdated'
}

/** True when the version cannot be compared with a latest release (the filter keeps such a mint). */
export function hasUnknownVersion(mint: VersionedMint): boolean {
  return classify(mint).minorsBehind === null
}

/** Filter predicate: off → every mint passes; on → every mint except the "outdated" ones. */
export function mintMatchesOutdated(mint: VersionedMint, hideOutdated: boolean): boolean {
  return !hideOutdated || !isOutdatedMint(mint)
}

/** The note shown while the filter is on: how many of the shown mints have a version that cannot be compared. */
export function unknownKeptNote(count: number): string {
  return `${count} ${count === 1 ? 'mint' : 'mints'} with unknown software ${count === 1 ? 'is' : 'are'} kept.`
}
