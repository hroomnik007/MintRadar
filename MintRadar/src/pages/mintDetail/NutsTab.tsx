// Mint Detail "NUTs" tab: fees & limits, the (mobile-only) keysets panel and the NUT compatibility grid.
// Extracted verbatim from MintDetail.tsx (pure refactor: same DOM, classes, inline styles, aria and tooltips).
// All data is computed by MintDetail and passed in; this component holds no state.
import type { ComponentProps, JSX, ReactNode } from 'react'
import {
  ShieldCheck, ShieldOff, Info,
  Coins, Flame, SlidersHorizontal, RefreshCw, Lock, Key, Shield,
  Clock, GitBranch, Plug, Database, Award, Layers, Zap, QrCode,
  Receipt, UserCheck, EyeOff, CreditCard, Send, Code, Cloud,
  Fingerprint, Bitcoin,
} from 'lucide-react'
import { InfoTooltip } from '@/components/InfoTooltip'
import { MintFeesLimits } from '@/components/mint/MintFeesLimits'
import { TRACKED_NUTS } from '@/constants/nuts'
import { clickableProps } from '@/utils/clickableProps'
import { BACKUP_SUPPORTED_TEXT, NO_BACKUP_TEXT } from '@/utils/tooltipTexts'
import { NUT_DESCRIPTIONS } from './nutCatalog'

/** One muted sentence under the NUT compatibility grid: which NUTs nutzaps (NIP-61) rely on. No verdict. */
const NUTZAP_NUTS_NOTE = 'NUT-07, NUT-10, NUT-11 and NUT-12 are the ones nutzaps (NIP-61) rely on.'

const NUT_ICONS: Record<string, JSX.Element> = {
  'NUT-04': <Coins size={13} />,
  'NUT-05': <Flame size={13} />,
  'NUT-07': <Info size={13} />,
  'NUT-08': <SlidersHorizontal size={13} />,
  'NUT-09': <RefreshCw size={13} />,
  'NUT-10': <Lock size={13} />,
  'NUT-11': <Key size={13} />,
  'NUT-12': <Shield size={13} />,
  'NUT-14': <Clock size={13} />,
  'NUT-15': <GitBranch size={13} />,
  'NUT-16': <QrCode size={13} />,
  'NUT-17': <Plug size={13} />,
  'NUT-18': <Receipt size={13} />,
  'NUT-19': <Database size={13} />,
  'NUT-20': <Award size={13} />,
  'NUT-21': <UserCheck size={13} />,
  'NUT-22': <EyeOff size={13} />,
  'NUT-23': <Zap size={13} />,
  'NUT-24': <CreditCard size={13} />,
  'NUT-25': <Send size={13} />,
  'NUT-26': <Code size={13} />,
  'NUT-27': <Cloud size={13} />,
  'NUT-28': <Fingerprint size={13} />,
  'NUT-29': <Layers size={13} />,
  'NUT-30': <Bitcoin size={13} />,
}

export interface NutsTabProps {
  /** Props for the Fees & limits panel; null while the mint is not in the known-mints list (panel hidden). */
  feesLimits: ComponentProps<typeof MintFeesLimits> | null
  /** The shared Keysets panel (shown here on mobile only; CSS hides it on desktop). */
  keysetsPanel: ReactNode
  supportsBackupRestore: boolean
  /** Tracked NUTs the mint declares as supported and has not switched off. */
  supportedNuts: string[]
  /** Tracked NUTs the mint declares but switched off (NUT-04/05 `disabled: true`, live /v1/info else the stored one). */
  disabledNuts: string[]
  onSelectNut: (nut: string) => void
}

export function NutsTab({ feesLimits, keysetsPanel, supportsBackupRestore, supportedNuts, disabledNuts, onSelectNut }: NutsTabProps) {
  return (<>
    {feesLimits && (
      <MintFeesLimits {...feesLimits} />
    )}

    {/* Mobile (<901px) only — on desktop the Keysets panel moves to the
        Overview sidebar next to "Units & Methods". */}
    <div className="md-keysets-at-nuts">{keysetsPanel}</div>

      <div className="md-panel">
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:11}}>
          <div className="md-panel-title" style={{marginBottom:0}}>NUT compatibility</div>
        {supportsBackupRestore ? (
          <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
            <span className="md-backup-pill" style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--accent)',background:'var(--green-soft)',border:'0.5px solid var(--green-soft-strong)',borderRadius:5,padding:'2px 7px'}}>
              <ShieldCheck size={11} /> Backup supported
            </span>
            <InfoTooltip iconSize={11} width={220} about="backup support" text={BACKUP_SUPPORTED_TEXT} />
          </span>
        ) : (
          <span style={{display:'inline-flex',alignItems:'center',gap:4}}>
            <span style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:10,fontFamily:'var(--font-mono)',fontWeight:600,color:'var(--text3)',background:'var(--bg3)',border:'0.5px solid var(--border)',borderRadius:5,padding:'2px 7px'}}>
              <ShieldOff size={11} /> No backup
            </span>
            <InfoTooltip iconSize={11} width={220} about="backup support" text={NO_BACKUP_TEXT} />
          </span>
        )}
      </div>
      <div className="nut-summary-line">
        <strong>{supportedNuts.length}</strong> of {TRACKED_NUTS.length} known NUTs supported
        {disabledNuts.length > 0 && <> · {disabledNuts.length} disabled</>}
      </div>
      <div className="nut-grid">
        {TRACKED_NUTS.map(nut => {
          const isDisabled = disabledNuts.includes(nut)
          const supported = isDisabled || supportedNuts.includes(nut)
          const meta = NUT_DESCRIPTIONS[nut]
          return (
            <div key={nut} className={`nut-card ${isDisabled ? 'nut-disabled' : supported ? 'supported' : 'unsupported'}`} {...clickableProps(() => onSelectNut(nut))}>
              <div className={`nut-icon ${isDisabled ? 'nut-disabled' : supported ? 'supported' : 'unsupported'}`}>
                {NUT_ICONS[nut] ?? (isDisabled ? '!' : supported ? '●' : '○')}
              </div>
              <div className="nut-info">
                <div className="nut-name">{nut}</div>
                <div className="nut-desc">{isDisabled ? 'Disabled by operator' : meta?.short ?? ''}</div>
              </div>
              <span className="nut-check" style={{ color: isDisabled ? 'var(--amber)' : supported ? 'var(--accent)' : 'var(--text3)' }}>
                {isDisabled ? '!' : supported ? '✓' : '–'}
              </span>
            </div>
          )
        })}
      </div>
      <div className="md-nut-nutzap-note">{NUTZAP_NUTS_NOTE}</div>
    </div>
  </>)
}
