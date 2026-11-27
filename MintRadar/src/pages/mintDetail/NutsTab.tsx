// Mint Detail "NUTs" tab (2026-11-19 redesign, phase 4d): the tracked NUTs in groups, Fees and limits, and what works with
// this mint. All data is computed by MintDetail and passed in; this component holds no state.
import type { ComponentProps } from 'react'
import { Ban, Check, Minus } from 'lucide-react'
import { MintFeesLimits } from '@/components/mint/MintFeesLimits'
import { TRACKED_NUTS } from '@/constants/nuts'
import { clickableProps } from '@/utils/clickableProps'
import { BACKUP_SUPPORTED_TEXT, NO_BACKUP_TEXT } from '@/utils/tooltipTexts'
import { NUT_GROUPS } from './nutCatalog'
import { nutzapNote } from '@/utils/mintDetailFacts'

/** The NUTs nutzaps (NIP-61) rely on (NUTZAP_NUTS_NOTE says the same in words). */
const NUTZAP_NUTS = ['NUT-07', 'NUT-10', 'NUT-11', 'NUT-12'] as const

export interface NutsTabProps {
  /** Props for the Fees & limits panel; null while the mint is not in the known-mints list (panel hidden). */
  feesLimits: ComponentProps<typeof MintFeesLimits> | null
  supportsBackupRestore: boolean
  /** Tracked NUTs the mint declares as supported and has not switched off. */
  supportedNuts: string[]
  /** Tracked NUTs the mint declares but switched off (NUT-04/05 `disabled: true`, live /v1/info else the stored one). */
  disabledNuts: string[]
  onSelectNut: (nut: string) => void
  /** Latest successful /v1/info time (MintDetail's infoFetchedAt: lastCheckedAt while online, else lastOnlineAt), for the nutzap sentence. */
  infoFetchedAt: string | null | undefined
  now: number
}

export function NutsTab({ feesLimits, supportsBackupRestore, supportedNuts, disabledNuts, onSelectNut, infoFetchedAt, now }: NutsTabProps) {
  // 2026-11-19 redesign (phase 4d): the tracked NUTs in groups with one plain sentence each, Fees and limits and
  // "What works with this mint" (the NUTs as things a user knows) beside them. No verdict words.
  const nutzapLine = nutzapNote(infoFetchedAt, now)
  const state = (nut: string): 'nut-disabled' | 'supported' | 'unsupported' =>
    disabledNuts.includes(nut) ? 'nut-disabled' : supportedNuts.includes(nut) ? 'supported' : 'unsupported'
  const has = (nut: string) => state(nut) === 'supported'
  const nutzapMissing = NUTZAP_NUTS.filter(n => !has(n))
  const works: Array<{ label: string; yes: boolean; text: string }> = [
    { label: 'Nutzaps (NIP-61)', yes: nutzapMissing.length === 0, text: nutzapMissing.length === 0 ? 'Yes, NUT-07, 10, 11 and 12 are supported' : `No, ${nutzapMissing.join(', ')} ${nutzapMissing.length === 1 ? 'is' : 'are'} missing` },
    { label: 'Restore from seed', yes: supportsBackupRestore, text: supportsBackupRestore ? 'Yes, NUT-09' : 'No, keep your own token backups' },
    { label: 'Live updates', yes: has('NUT-17'), text: has('NUT-17') ? 'Yes, WebSocket (NUT-17)' : 'No, wallets ask the mint again' },
    { label: 'Pay one invoice from several mints', yes: has('NUT-15'), text: has('NUT-15') ? 'Yes, NUT-15' : 'No' },
  ]
  return (
    <div className="md-nuts">
      <section className="md-panel md-nuts-features" aria-labelledby="md-nuts-title">
        <div className="md-panel-h">
          <div>
            <h2 id="md-nuts-title" className="md-panel-title">Supported features</h2>
            <p className="md-panel-sub nut-summary-line">
              <strong>{supportedNuts.length}</strong> of the {TRACKED_NUTS.length} NUTs we track, as declared in the mint&apos;s /v1/info
              {disabledNuts.length > 0 && <>, {disabledNuts.length} switched off by the operator</>}
              {nutzapLine.time ? <>, checked <span title={nutzapLine.time.title}>{nutzapLine.time.label}</span>.</> : '.'}
            </p>
          </div>
        </div>
        {NUT_GROUPS.map(g => (
          <div key={g.title} className="nut-group">
            <h3 className="nut-group-title">{g.title}</h3>
            {g.nuts.map(({ nut, name, line }) => {
              const s = state(nut)
              // No aria-label (A2, review 2026-11-27): it replaced the row's text, so a screen reader never heard
              // "Supported" / "Not supported". The name is the text: NUT, name, line and state.
              return (
                <div key={nut} className={`nut-card nut-row ${s}`} {...clickableProps(() => onSelectNut(nut))}>
                  <span className="nut-tag">{nut}</span>
                  <span className="nut-row-name"><b>{name}</b><span>{line}</span></span>
                  <span className={`nut-row-state ${s}`}>
                    {s === 'supported' ? <Check size={14} aria-hidden="true" /> : s === 'nut-disabled' ? <Ban size={14} aria-hidden="true" /> : <Minus size={14} aria-hidden="true" />}
                    {s === 'supported' ? 'Supported' : s === 'nut-disabled' ? 'Disabled by operator' : 'Not supported'}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
        {/* One muted sentence: which NUTs nutzaps (NIP-61) rely on, with the source and time. No verdict. */}
        <div className="md-nut-nutzap-note">
          {nutzapLine.lead}
          {nutzapLine.time ? <>, checked <span title={nutzapLine.time.title}>{nutzapLine.time.label}</span>.</> : '.'}
        </div>
      </section>
      <div className="md-nuts-side">
        {feesLimits && <MintFeesLimits {...feesLimits} />}
        <section className="md-panel md-nuts-works" aria-labelledby="md-works-title">
          <h2 id="md-works-title" className="md-panel-title">What works with this mint</h2>
          <dl className="md-works">
            {works.map(w => (
              <div key={w.label} className="md-info-row">
                <dt className="md-info-label">{w.label}</dt>
                <dd className={`md-info-value md-works-${w.yes ? 'yes' : 'no'}`}>{w.text}</dd>
              </div>
            ))}
          </dl>
          <p className="md-panel-hint">{supportsBackupRestore ? BACKUP_SUPPORTED_TEXT : NO_BACKUP_TEXT}</p>
        </section>
      </div>
    </div>
  )
}
