// One table of cases for the version rule, shared by versionRule.test.ts and sharedModules.test.ts
// (the backend copy has the same table in backend/src/__tests__/versionRule.test.ts).
import type { LatestVersion, VersionLabel } from '../shared/versionRule.js'

const NUT: LatestVersion = { major: 0, minor: 21 } // Nutshell latest 0.21.0
const CDK: LatestVersion = { major: 0, minor: 18 } // cdk-mintd latest 0.18.1

export interface VersionCase {
  name: string
  software: string | null
  version: string | null
  latest: LatestVersion | null
  label: VersionLabel
  points: number
  behind?: number | null
}

export const VERSION_CASES: VersionCase[] = [
  { name: 'Nutshell 0.21.0 is latest', software: 'Nutshell', version: '0.21.0', latest: NUT, label: 'latest', points: 15, behind: 0 },
  { name: 'Nutshell 0.21.1 (higher) is latest', software: 'Nutshell', version: '0.21.1', latest: NUT, label: 'latest', points: 15, behind: 0 },
  { name: 'Nutshell 0.20.3.1 one minor behind: no label, 15', software: 'Nutshell', version: '0.20.3.1', latest: NUT, label: null, points: 15, behind: 1 },
  { name: 'Nutshell 0.20.3 one minor behind: no label, 15', software: 'Nutshell', version: '0.20.3', latest: NUT, label: null, points: 15, behind: 1 },
  { name: 'Nutshell 0.19.2 two behind: outdated, 9', software: 'Nutshell', version: '0.19.2', latest: NUT, label: 'outdated', points: 9, behind: 2 },
  { name: 'Nutshell 0.18.2 three behind: outdated, 6', software: 'Nutshell', version: '0.18.2', latest: NUT, label: 'outdated', points: 6, behind: 3 },
  { name: 'Nutshell 0.17.0 four behind: outdated, 3', software: 'Nutshell', version: '0.17.0', latest: NUT, label: 'outdated', points: 3, behind: 4 },
  { name: 'Nutshell 0.16.0 five behind: outdated, 0', software: 'Nutshell', version: '0.16.0', latest: NUT, label: 'outdated', points: 0, behind: 5 },
  { name: 'Software/ prefix inside the version', software: null, version: 'Nutshell/0.21.0', latest: NUT, label: 'latest', points: 15, behind: 0 },
  { name: 'leading v', software: 'Nutshell', version: 'v0.20.3', latest: NUT, label: null, points: 15, behind: 1 },
  { name: 'cdk-mintd 0.18.0-rc.1 vs stable 0.18: current, no label', software: 'cdk-mintd', version: '0.18.0-rc.1', latest: CDK, label: null, points: 15, behind: 0 },
  { name: 'cdk-mintd 0.18.0-rc.0: no label', software: 'cdk-mintd', version: '0.18.0-rc.0', latest: CDK, label: null, points: 15, behind: 0 },
  { name: 'cdk-mintd 0.17.7 one behind: no label, 15', software: 'cdk-mintd', version: '0.17.7', latest: CDK, label: null, points: 15, behind: 1 },
  { name: 'cdk-mintd 0.17.0-rc.3 counts as 0.17.0: no label, 15', software: 'cdk-mintd', version: '0.17.0-rc.3', latest: CDK, label: null, points: 15, behind: 1 },
  { name: 'cdk-mintd 0.16.2 two behind: outdated, 9', software: 'cdk-mintd', version: '0.16.2', latest: CDK, label: 'outdated', points: 9, behind: 2 },
  { name: 'cdk-mintd 0.13.4 five behind: outdated, 0', software: 'cdk-mintd', version: '0.13.4', latest: CDK, label: 'outdated', points: 0, behind: 5 },
  { name: 'a lower major is outdated with 0 points', software: 'Nutshell', version: '0.99.0', latest: { major: 1, minor: 2 }, label: 'outdated', points: 0, behind: Infinity },
  { name: 'a higher major than latest is latest', software: 'Nutshell', version: '1.0.0', latest: NUT, label: 'latest', points: 15, behind: 0 },
  { name: 'unknown software keeps 4 points', software: 'LekMint', version: '1.1.1', latest: NUT, label: null, points: 4, behind: null },
  { name: 'Nutshell-CF is unknown software', software: 'Nutshell-CF', version: '0.0.1', latest: NUT, label: null, points: 4, behind: null },
  { name: 'an unparsable version keeps 5 points', software: 'Nutshell', version: 'garbage', latest: NUT, label: null, points: 5, behind: null },
  { name: 'no version = 0 points', software: 'Nutshell', version: null, latest: NUT, label: null, points: 0, behind: null },
  { name: 'known family without any latest: neutral 4', software: 'Nutshell', version: '0.21.0', latest: null, label: null, points: 4, behind: null },
]

/** [newer, older] pairs for the ordering comparator. */
export const ORDER_CASES: Array<[string, string]> = [
  ['0.20.3.1', '0.20.3'],
  ['0.18.1', '0.18.1-rc.2'],
  ['0.18.1-rc.2', '0.18.1-rc.1'],
  ['0.21.0', '0.20.3.1'],
  ['0.18.0', '0.18.0-rc.1'],
  ['0.20.3', 'garbage'],
]
