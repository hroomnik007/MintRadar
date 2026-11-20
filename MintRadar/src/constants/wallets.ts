// Static, hand-maintained list of Cashu-compatible wallets shown on the Wallets
// page. This is deliberately a hardcoded array rather than a DB table / API
// endpoint: the list changes rarely, carries no per-mint or user data, and needs
// no ranking, reviews or moderation. Purely informational.
//
// The Wallets page sorts the entries alphabetically (2026-11-19: an order that cannot be read as a ranking); each `blurb` is one plain sentence
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
  /** Shown in the "Run your own mint" section below the wallet grid, not in it. */
  selfHost?: boolean
}

export const WALLETS: WalletInfo[] = [
  {
    name: 'Minibits',
    platforms: ['Android', 'iOS'],
    blurb: 'Mobile-first ecash wallet with a built-in Lightning address and named contacts, aimed at everyday spending.',
    url: 'https://minibits.cash',
  },
  {
    name: 'Nutstash',
    platforms: ['Web', 'Android'],
    blurb: 'Cross-platform wallet with multi-mint management and swap tools, useful for juggling balances across several mints.',
    url: 'https://nutstash.app',
  },
  {
    name: 'Macadamia',
    platforms: ['iOS'],
    blurb: 'The first fully native iOS wallet for Cashu, built in Swift around a privacy-focused, cash-like payment flow.',
    url: 'https://macadamia.cash',
  },
  {
    name: 'Sovran',
    platforms: ['iOS'],
    blurb: 'Free and open-source iOS wallet for Cashu and Lightning with multi-mint management, NFC payments and built-in Nostr.',
    url: 'https://sovran.money',
  },
  {
    name: 'Cashu.me',
    platforms: ['Web'],
    blurb: 'The reference browser wallet: no install, good for trying Cashu and testing a new mint quickly.',
    url: 'https://wallet.cashu.me',
  },
  {
    name: 'Agicash',
    platforms: ['Web'],
    blurb: 'Self-custodial web wallet for dollar-denominated ecash, built on the Open Secret platform for quick onboarding with no install (formerly Boardwalk Cash).',
    url: 'https://agi.cash',
  },
  {
    name: 'Coinos',
    platforms: ['Web', 'Android', 'iOS'],
    blurb: 'Hosted wallet that speaks Cashu alongside Lightning and on-chain, convenient if you want one account for everything.',
    url: 'https://coinos.io',
  },
  {
    name: 'Zeus',
    platforms: ['Android', 'iOS'],
    blurb: 'Self-custodial Lightning wallet that also speaks Cashu through the Cashu Development Kit, if you want ecash inside a full Bitcoin wallet.',
    url: 'https://zeusln.com',
  },
  {
    name: 'Linky',
    platforms: ['Web'],
    blurb: 'Contact and messaging PWA (Nostr and Lightning) with a built-in Cashu wallet: receive ecash to an npub address and send tokens in chat.',
    url: 'https://linky.fit',
  },
  {
    name: 'Nutshell',
    platforms: ['CLI'],
    blurb: 'Python, mint and CLI wallet.',
    url: 'https://github.com/cashubtc/nutshell',
    selfHost: true,
  },
  {
    name: 'cdk-mintd',
    platforms: ['CLI'],
    blurb: 'Rust, built on the Cashu Development Kit.',
    url: 'https://github.com/cashubtc/cdk',
    selfHost: true,
  },
]
