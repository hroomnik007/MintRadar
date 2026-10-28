// Every number the /methodology page quotes, in ONE structure. The page (pages/Methodology.tsx) renders its
// text from these values and nothing else, and src/__tests__/methodologyPage.test.ts compares each of them
// with the constant or the function it describes (weights, audit bands, neutral value, minimum swaps, freshness,
// cap and its days, the 14-day gate, the version threshold, the cadences). Changing a formula constant without
// updating this file fails that test. A formula change also needs a METHODOLOGY_CHANGES entry and a
// METHODOLOGY_VERSION bump (src/utils/methodology.ts, backend/src/shared/methodology.ts).

export const METHODOLOGY_PAGE = {
  /** Maximum points per component; they add up to 100. */
  weights: { uptime: 40, audit: 25, nuts: 15, version: 15, contact: 5 },

  uptime: {
    windowHours: 24,
    /** Points = round(uptimePercent x this factor); uptimePercent is rounded to a whole number first. */
    factor: 0.4,
  },

  audit: {
    windowDays: 7,
    minSwaps: 10,
    maxAgeHours: 168,
    neutral: 12.5,
    /**
     * Error rate = attributed failures / swaps in the window. `below` is the exclusive upper bound of the band
     * (null = no upper bound), `points` what the band scores. The rate exactly on a bound belongs to the next band.
     */
    bands: [
      { label: 'exactly 0 %', below: null as number | null, zero: true, points: 25 },
      { label: 'below 1 %', below: 0.01, zero: false, points: 20 },
      { label: '1 % to below 5 %', below: 0.05, zero: false, points: 15 },
      { label: '5 % to below 15 %', below: 0.15, zero: false, points: 10 },
      { label: '15 % and above', below: null as number | null, zero: false, points: 5 },
    ],
  },

  nuts: {
    /** The tracked mint-side NUTs: the denominator of the component. */
    tracked: ['4', '5', '7', '8', '9', '10', '11', '12', '14', '15', '17', '19', '20', '29'],
  },

  version: {
    /** Minor versions behind the newest stable release from which a mint is "outdated". */
    outdatedFromMinorsBehind: 2,
    /** Points by minor versions behind: index 0 and 1 are both full, 5 or more is 0. */
    pointsByMinorsBehind: [15, 15, 9, 6, 3],
    pointsFiveOrMoreBehind: 0,
    pointsUnknownSoftware: 4,
    pointsUnreadableVersion: 5,
    pointsNoVersion: 0,
    /** A new upstream release counts as "newest" only this many days after it was published. */
    releaseGraceDays: 14,
    /** Without a catalog value: the highest stable version that at least this many distinct mints report exactly. */
    fallbackMinMints: 2,
    families: ['Nutshell', 'cdk / cdk-mintd'],
  },

  contact: {
    /** Channels counted (email, Twitter, Nostr); more than this earns nothing extra. */
    maxChannels: 3,
  },

  newMint: { capPoints: 75, capDays: 30 },
  recommendation: { minAgeDays: 14, maxProbeAgeHours: 3 },

  cadence: {
    probeMinutes: 5,
    probeTimeoutSeconds: 10,
    detailMinutes: 30,
    catalogHours: 24,
    snapshotSeconds: 60,
  },
} as const
