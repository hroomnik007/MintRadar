// Static, hand-maintained list of Cashu-compatible wallets shown on the Wallets
// page. This is deliberately a hardcoded array rather than a DB table / API
// endpoint: the list changes rarely, carries no per-mint or user data, and needs
// no ranking, reviews or moderation. Purely informational.
//
// Keep entries alphabetical-ish by relevance; each `blurb` is one plain sentence
// in English (the app is EN-first). Every `url` must be an absolute https:// link
// to the wallet's own site — it is rendered as an external link.

export type WalletPlatform = 'Android' | 'iOS' | 'Web' | 'CLI'

export interface WalletInfo {
  /** Display name. */
  name: string
  /** Platforms the wallet ships on. */
  platforms: WalletPlatform[]
  /** One sentence on what this wallet is good for. */
  blurb: string
  /** Absolute https:// link to the wallet's homepage or repo. */
  url: string
}

export const WALLETS: WalletInfo[] = [
  {
    name: 'Minibits',
    platforms: ['Android'],
    blurb: 'Mobile-first ecash wallet with a built-in Lightning address and named contacts, aimed at everyday spending.',
    url: 'https://www.minibits.cash',
  },
  {
    name: 'Nutstash',
    platforms: ['Web', 'Android'],
    blurb: 'Cross-platform wallet with multi-mint management and swap tools, useful for juggling balances across several mints.',
    url: 'https://nutstash.app',
  },
  {
    name: 'eNuts',
    platforms: ['Android', 'iOS'],
    blurb: 'Native mobile wallet for Android and iOS with multi-mint support and Lightning top-ups.',
    url: 'https://www.enuts.cash',
  },
  {
    name: 'Cashu.me',
    platforms: ['Web'],
    blurb: 'The reference browser wallet — no install, good for trying Cashu and testing a new mint quickly.',
    url: 'https://cashu.me',
  },
  {
    name: 'Boardwalk Cash',
    platforms: ['Web'],
    blurb: 'Installable web app focused on fast Lightning-address payments and a simple send/receive flow.',
    url: 'https://boardwalkcash.com',
  },
  {
    name: 'Coinos',
    platforms: ['Web', 'Android', 'iOS'],
    blurb: 'Hosted wallet that speaks Cashu alongside Lightning and on-chain, convenient if you want one account for everything.',
    url: 'https://coinos.io',
  },
  {
    name: 'Nutshell',
    platforms: ['CLI'],
    blurb: 'The reference Python implementation, including a command-line wallet handy for scripting and running your own mint.',
    url: 'https://github.com/cashubtc/nutshell',
  },
]
