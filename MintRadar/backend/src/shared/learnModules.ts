// Backend copy of src/constants/learnModules.ts (the Learn module list: ids, titles, summaries, order), used by the
// server-side head of index.html (spaHtml.ts) and the sitemap. No imports, so the two copies are byte-identical (code,
// comments aside); src/__tests__/sharedModules.test.ts fails when they drift. SOURCE OF TRUTH is the frontend file
// (the module pages live there): change it there first and mirror the change here.

export interface LearnModuleMeta {
  id: string
  title: string
  summary: string
  order: number
  // Shown as "N min read" on the index card. Recomputed from the module text by src/__tests__/learnReadingTime.test.tsx.
  readingMinutes: number
}

export const LEARN_MODULES: LearnModuleMeta[] = [
  {
    id: 'cashu-basics',
    title: 'Cashu Basics',
    summary: 'What Cashu actually is: the mint holds your Bitcoin, you hold a bearer token, and blind signatures keep person-to-person transfers private.',
    order: 1,
    readingMinutes: 3,
  },
  {
    id: 'understanding-the-risks',
    title: 'Understanding the Risks',
    summary: 'Why a mint can disappear or refuse to pay, why nobody can currently verify a mint has real backing, and how to limit what you stand to lose.',
    order: 2,
    readingMinutes: 3,
  },
  {
    id: 'how-to-choose-a-mint',
    title: 'How to Choose a Cashu Mint',
    summary: 'What to check before trusting a mint — uptime, NUT support, operator transparency — and how MintRadar\'s Reliability Score combines those signals.',
    order: 3,
    readingMinutes: 6,
  },
  {
    id: 'getting-started-with-a-wallet',
    title: 'Getting Started with a Wallet',
    summary: 'Choosing a wallet, adding your first mint, making a deposit, sending tokens, and why backing up your seed phrase is non-negotiable.',
    order: 4,
    readingMinutes: 4,
  },
  {
    id: 'safe-habits',
    title: 'Safe Habits',
    summary: 'Five day-to-day habits — diversifying mints, redeeming regularly, checking Reliability Score first — that meaningfully reduce your risk.',
    order: 5,
    readingMinutes: 3,
  },
]
