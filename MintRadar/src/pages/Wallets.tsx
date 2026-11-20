import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { WALLETS } from '@/constants/wallets'
import type { WalletInfo, WalletPlatform } from '@/constants/wallets'
import { PageHead } from '@/components/layout/PageHead'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { ROUTE_META_BY_PATH } from '@/utils/pageMeta'
import './Wallets.css'

function hostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

/** Alphabetical, case-insensitive: an order that cannot be read as a ranking (2026-11-19 redesign). */
const byName = (a: WalletInfo, b: WalletInfo) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })

// 2026-11-19 redesign (phase 6a): the whole card is the link (name 20px), the platforms are tags under the name, the
// site in copper; a platform filter over the list; "Run your own mint" is one panel of rows.
function WalletCard({ w }: { w: WalletInfo }) {
  return (
    <a className="wallet-card" href={w.url} target="_blank" rel="noopener noreferrer">
      <span className="wallet-name">{w.name}</span>
      <span className="wallet-platforms">
        {w.platforms.map(p => <span key={p} className="wallet-platform-tag">{p}</span>)}
      </span>
      <span className="wallet-blurb">{w.blurb}</span>
      <span className="wallet-link">{hostname(w.url)}<ArrowUpRight size={14} aria-hidden="true" /></span>
    </a>
  )
}

export default function Wallets() {
  const wallets = WALLETS.filter(w => !w.selfHost).sort(byName)
  // The reference implementation first, as in the approved mockup (Nutshell, then cdk-mintd).
  const selfHost = WALLETS.filter(w => w.selfHost)
  const platforms = (['Android', 'iOS', 'Web', 'CLI'] as WalletPlatform[]).filter(p => wallets.some(w => w.platforms.includes(p)))
  const [platform, setPlatform] = useState<WalletPlatform | 'all'>('all')
  const shown = platform === 'all' ? wallets : wallets.filter(w => w.platforms.includes(platform))

  useDocumentMeta(ROUTE_META_BY_PATH['/wallets'].title, ROUTE_META_BY_PATH['/wallets'].description)

  return (
    <div className="wallets-page">
      <PageHead
        className="wallets-header"
        titleClassName="wallets-title"
        descriptionClassName="wallets-subtitle"
        title="Wallets"
        description="Wallets that work with Cashu mints, in alphabetical order. We do not rank or review them."
      />

      <div className="wallets-filter">
        <span className="wallets-filter-label" id="wallets-filter-label">Show</span>
        <div className="wallets-seg" role="group" aria-labelledby="wallets-filter-label">
          {(['all', ...platforms] as const).map(p => (
            <button key={p} type="button" className={platform === p ? 'on' : ''} aria-pressed={platform === p} onClick={() => setPlatform(p)}>
              {p === 'all' ? 'All' : p}
            </button>
          ))}
        </div>
      </div>

      <div className="wallets-grid">
        {shown.map(w => <WalletCard key={w.name} w={w} />)}
      </div>

      {selfHost.length > 0 && (
        <section className="wallets-selfhost" aria-labelledby="wallets-selfhost-title">
          <div>
            <h2 id="wallets-selfhost-title" className="wallets-selfhost-title">Run your own mint</h2>
            <p className="wallets-selfhost-sub">Not a wallet: the reference software for operators and for scripting.</p>
          </div>
          <dl className="wallets-selfhost-rows">
            {selfHost.map(w => (
              <div key={w.name} className="wallets-selfhost-row">
                <dt>{w.name}</dt>
                <dd>{w.blurb} <a href={w.url} target="_blank" rel="noopener noreferrer">{hostname(w.url)}{new URL(w.url).pathname.replace(/\/$/, '')}</a></dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <div className="wallets-footnote">
        Listing a wallet here is not an endorsement. Always check a wallet yourself before putting funds in it.
      </div>
    </div>
  )
}
