// Single source of truth for the Learn section's module list and ordering.
// Module content itself lives in src/pages/learn/Module{N}.tsx — this file
// only carries the metadata needed to render the module grid and the
// prev/next navigation on LearnModule.tsx.

export interface LearnModuleMeta {
  id: string
  title: string
  summary: string
  order: number
}

export const LEARN_MODULES: LearnModuleMeta[] = [
  {
    id: 'cashu-basics',
    title: 'Cashu Basics',
    summary: 'What Cashu actually is: the mint holds your Bitcoin, you hold a bearer token, and blind signatures keep person-to-person transfers private.',
    order: 1,
  },
  {
    id: 'understanding-the-risks',
    title: 'Understanding the Risks',
    summary: 'Why a mint can disappear or refuse to pay, why nobody can currently verify a mint has real backing, and how to limit what you stand to lose.',
    order: 2,
  },
  {
    id: 'how-to-choose-a-mint',
    title: 'How to Choose a Mint',
    summary: 'What to check before trusting a mint — uptime, NUT support, operator transparency — and how MintRadar\'s Trust Score combines those signals.',
    order: 3,
  },
  {
    id: 'getting-started-with-a-wallet',
    title: 'Getting Started with a Wallet',
    summary: 'Choosing a wallet, adding your first mint, making a deposit, sending tokens, and why backing up your seed phrase is non-negotiable.',
    order: 4,
  },
  {
    id: 'safe-habits',
    title: 'Safe Habits',
    summary: 'Five day-to-day habits — diversifying mints, redeeming regularly, checking Trust Score first — that meaningfully reduce your risk.',
    order: 5,
  },
]
