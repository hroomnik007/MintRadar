// Single source of truth for the Learn section's module list and ordering. Titles in sentence case and the summaries
// as edited in the 2026-11-19 redesign (approved by the owner).
// Module content itself lives in src/pages/learn/Module{N}.tsx — this file
// only carries the metadata needed to render the module grid and the
// prev/next navigation on LearnModule.tsx.

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
    title: 'Cashu basics',
    summary: 'What Cashu actually is: the mint holds your bitcoin, you hold a bearer token, and blind signatures keep person-to-person transfers private.',
    order: 1,
    readingMinutes: 2,
  },
  {
    id: 'understanding-the-risks',
    title: 'Understanding the risks',
    summary: 'Why a mint can disappear or refuse to pay, why nobody can yet verify that a mint has real backing, and how to limit what you stand to lose.',
    order: 2,
    readingMinutes: 3,
  },
  {
    id: 'how-to-choose-a-mint',
    title: 'How to choose a Cashu mint',
    summary: 'What to check before you trust a mint (uptime, NUT support, operator transparency) and how the Reliability Score combines those signals.',
    order: 3,
    readingMinutes: 6,
  },
  {
    id: 'getting-started-with-a-wallet',
    title: 'Getting started with a wallet',
    summary: 'Choosing a wallet, adding your first mint, making a deposit, sending tokens, and why a seed backup is not optional.',
    order: 4,
    readingMinutes: 4,
  },
  {
    id: 'safe-habits',
    title: 'Safe habits',
    summary: 'Five day-to-day habits that lower your risk: spread your sats across mints, redeem regularly, check the Reliability Score first.',
    order: 5,
    readingMinutes: 3,
  },
]
