import { useId, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { CodeBlock } from '@/components/CodeBlock'
import { NUT_META, TRACKED_NUTS } from '@/constants/nuts'
import { WALLET_API_BASE } from '@/constants/forWalletsPage'
import {
  buildWalletRequest, walletCurlSnippet, walletFetchSnippet, WALLET_REQUEST_PARAMS,
  type WalletParamName, type WalletRequestValues,
} from '@/utils/walletRequestBuilder'
import './WalletRequestBuilder.css'

// The "Build a request" section of /for-wallets. State lives in React only: no storage, no URL sync, no network.
// Every value reaches the snippets through buildWalletRequest (utils/walletRequestBuilder.ts), which validates it
// against the real parser's rules and leaves invalid fields out. All values are rendered as text by React.

const UNITS = ['SAT', 'USD', 'EUR'] as const
const METHODS = ['bolt11', 'bolt12', 'onchain'] as const
const INCLUDES = ['facts', 'keysets', 'methods', 'breakdown', 'changes'] as const
const FLAGS = [
  { name: 'includeOffline', label: 'Offline' },
  { name: 'includeArchived', label: 'Archived' },
  { name: 'includeTest', label: 'Test mints' },
  { name: 'includeUnscored', label: 'Unscored' },
] as const

type FlagName = (typeof FLAGS)[number]['name']

interface FormState {
  unit: string // '' = any, otherwise one of UNITS
  minScore: number
  nuts: string[] // NUT numbers as the API writes them ('4', '11')
  method: string
  limit: string
  maxInputFeePpk: string
  eligible: string // '' | 'true' | 'false'
  flags: Record<FlagName, boolean>
  include: string[]
  changedSince: string
}

const INITIAL: FormState = {
  unit: '', minScore: 0, nuts: [], method: '', limit: '', maxInputFeePpk: '', eligible: '',
  flags: { includeOffline: false, includeArchived: false, includeTest: false, includeUnscored: false },
  include: [], changedSince: '',
}

const maxLen = (name: WalletParamName): number | undefined => WALLET_REQUEST_PARAMS.find(p => p.name === name)?.maxLength
// Longest integer the builder reads (7 digits); the same limit as MAX_INTEGER_DIGITS in the data layer.
const INTEGER_MAX_LENGTH = 7

const HINTS = {
  limit: 'How many mints to return, 1 to 200 (default 100).',
  eligible: 'true: online, scored, not a test mint, first seen 14 or more days ago and checked in the last 3 hours. false: only the others.',
  changedSince: 'Only mints whose public data (key, fees, keysets, name, description, message of the day, contacts, version, NUTs, payment methods) changed after this time. Score and status changes are not included. Accepts an ISO 8601 time with Z or an offset, a date, or UNIX seconds.',
} as const

const toggle = (list: string[], v: string): string[] => (list.includes(v) ? list.filter(x => x !== v) : [...list, v])

function toValues(s: FormState): WalletRequestValues {
  return {
    unit: s.unit.toLowerCase(),
    minScore: s.minScore > 0 ? String(s.minScore) : '',
    nuts: s.nuts,
    method: s.method,
    limit: s.limit,
    maxInputFeePpk: s.maxInputFeePpk,
    eligible: s.eligible,
    ...s.flags,
    include: s.include,
    changedSince: s.changedSince,
  }
}

/** How many of the "More options" parameters are set (a parameter counts once, valid or not). */
function moreOptionsSet(s: FormState): number {
  return [
    s.maxInputFeePpk.trim() !== '', s.eligible !== '', ...FLAGS.map(f => s.flags[f.name]),
    s.include.length > 0, s.changedSince.trim() !== '',
  ].filter(Boolean).length
}

function Seg({ legend, param, name, value, options, onChange, hint, hintId }: {
  legend: string; param: string; name: string; value: string
  options: readonly { value: string; label: string }[]; onChange: (v: string) => void
  hint?: string; hintId?: string
}) {
  return (
    <fieldset className="wg-field" aria-describedby={hint ? hintId : undefined}>
      <legend className="wg-label">{legend} <code>{param}</code></legend>
      <div className="wg-seg">
        {options.map(o => (
          <label key={o.value} className={`wg-seg-opt${value === o.value ? ' is-active' : ''}`}>
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {hint && <p className="wg-hint" id={hintId}>{hint}</p>}
    </fieldset>
  )
}

function Chips({ legend, param, items, selected, onToggle }: {
  legend: string; param: string; items: readonly { value: string; label: string }[]; selected: string[]; onToggle: (v: string) => void
}) {
  return (
    <fieldset className="wg-field">
      <legend className="wg-label">{legend} <code>{param}</code></legend>
      <div className="wg-chips">
        {items.map(i => (
          <label key={i.value} className={`wg-chip${selected.includes(i.value) ? ' is-active' : ''}`}>
            <input type="checkbox" value={i.value} checked={selected.includes(i.value)} onChange={() => onToggle(i.value)} />
            <span>{i.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function WalletRequestBuilder() {
  const uid = useId()
  const [s, setS] = useState<FormState>(INITIAL)
  const [open, setOpen] = useState(false)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setS(prev => ({ ...prev, [k]: v }))

  const fill = Math.min(100, Math.max(0, Math.round(s.minScore))) // 0..100, the only value that reaches the style
  const request = useMemo(() => buildWalletRequest(toValues(s)), [s])
  const { curl, fetchCode } = useMemo(() => {
    // The URL comes from the builder, which only emits characters the snippets accept; the fallback is the bare request.
    try { return { curl: walletCurlSnippet(request.url), fetchCode: walletFetchSnippet(request.url) } } catch {
      const bare = `${WALLET_API_BASE}/wallets/mints`
      return { curl: walletCurlSnippet(bare), fetchCode: walletFetchSnippet(bare) }
    }
  }, [request.url])

  const errors = useMemo(() => {
    const m = new Map<WalletParamName, string>()
    for (const e of request.errors) m.set(e.field, e.message)
    return m
  }, [request.errors])

  const moreSet = moreOptionsSet(s)
  const panelId = `${uid}-more`
  const err = (f: WalletParamName) => errors.get(f)
  const errId = (f: WalletParamName) => `${uid}-err-${f}`
  const invalid = (f: WalletParamName) => (err(f) ? { 'aria-invalid': true as const } : {})
  const describedBy = (f: WalletParamName, hint?: string) => {
    const ids = [hint, err(f) ? errId(f) : undefined].filter(Boolean).join(' ')
    return ids ? { 'aria-describedby': ids } : {}
  }
  const errLine = (f: WalletParamName) => (err(f) ? <p className="wg-error" id={errId(f)}>{err(f)}</p> : null)

  const nutItems = TRACKED_NUTS.map(n => ({ value: String(parseInt(n.slice(4), 10)), label: `${n} ${NUT_META[n]?.short ?? ''}`.trim() }))

  return (
    <div className="wg-builder">
      <Seg
        legend="Unit" param="unit" name={`${uid}-unit`} value={s.unit}
        options={[{ value: '', label: 'Any' }, ...UNITS.map(u => ({ value: u, label: u }))]}
        onChange={v => set('unit', v)}
      />

      <div className="wg-field">
        <label className="wg-label" htmlFor={`${uid}-minScore`}>Minimum score <code>minScore</code></label>
        <div className="wg-range-row">
          <input
            id={`${uid}-minScore`} className="wg-range" type="range" min={0} max={100} step={1} value={s.minScore}
            style={{ '--wg-fill': `${fill}%` } as CSSProperties}
            aria-valuetext={s.minScore === 0 ? 'any' : String(s.minScore)}
            onChange={e => set('minScore', Number(e.target.value))}
          />
          <output className="wg-readout" htmlFor={`${uid}-minScore`}>{s.minScore === 0 ? 'any' : s.minScore}</output>
        </div>
      </div>

      <Chips legend="Required NUTs" param="nuts" items={nutItems} selected={s.nuts} onToggle={v => set('nuts', toggle(s.nuts, v))} />

      <Seg
        legend="Payment method" param="method" name={`${uid}-method`} value={s.method}
        options={[{ value: '', label: 'Any' }, ...METHODS.map(m => ({ value: m, label: m }))]}
        onChange={v => set('method', v)}
      />

      <div className="wg-field">
        <label className="wg-label" htmlFor={`${uid}-limit`}>Max results <code>limit</code></label>
        <input
          id={`${uid}-limit`} className="wg-input wg-input-short" type="number" inputMode="numeric" min={1} max={200}
          placeholder="100" value={s.limit} onChange={e => set('limit', e.target.value.slice(0, INTEGER_MAX_LENGTH))}
          {...invalid('limit')} {...describedBy('limit', `${uid}-limit-hint`)}
        />
        <p className="wg-hint" id={`${uid}-limit-hint`}>{HINTS.limit}</p>
        {errLine('limit')}
      </div>

      <div className="wg-more">
        <button
          type="button" className="wg-more-btn" aria-expanded={open} aria-controls={panelId}
          onClick={() => setOpen(o => !o)}
        >
          <svg className="wg-chevron" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
            <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>More options</span>
          {moreSet > 0 && <span className="wg-more-count">({moreSet} set)</span>}
        </button>

        <div id={panelId} className="wg-more-panel" hidden={!open}>
          <div className="wg-field">
            <label className="wg-label" htmlFor={`${uid}-fee`}>Max input fee <code>maxInputFeePpk</code></label>
            <input
              id={`${uid}-fee`} className="wg-input wg-input-short" type="number" inputMode="numeric" min={0} max={1000000}
              placeholder="no limit" value={s.maxInputFeePpk}
              onChange={e => set('maxInputFeePpk', e.target.value.slice(0, INTEGER_MAX_LENGTH))}
              {...invalid('maxInputFeePpk')} {...describedBy('maxInputFeePpk')}
            />
            {errLine('maxInputFeePpk')}
          </div>

          <Seg
            legend="Eligible mints" param="eligible" name={`${uid}-eligible`} value={s.eligible}
            hint={HINTS.eligible} hintId={`${uid}-eligible-hint`}
            options={[{ value: '', label: 'Any' }, { value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
            onChange={v => set('eligible', v)}
          />

          <fieldset className="wg-field">
            <legend className="wg-label">Include in the list</legend>
            <div className="wg-checks">
              {FLAGS.map(f => (
                <label key={f.name} className="wg-check">
                  <input
                    type="checkbox" checked={s.flags[f.name]}
                    onChange={e => setS(prev => ({ ...prev, flags: { ...prev.flags, [f.name]: e.target.checked } }))}
                  />
                  <span>{f.label} <code>{f.name}</code></span>
                </label>
              ))}
            </div>
          </fieldset>

          <Chips
            legend="Extra detail per mint" param="include" items={INCLUDES.map(i => ({ value: i, label: i }))}
            selected={s.include} onToggle={v => set('include', toggle(s.include, v))}
          />

          <div className="wg-field">
            <label className="wg-label" htmlFor={`${uid}-since`}>Changed since <code>changedSince</code></label>
            <input
              id={`${uid}-since`} className="wg-input" type="text" autoComplete="off" spellCheck={false}
              maxLength={maxLen('changedSince')} value={s.changedSince} onChange={e => set('changedSince', e.target.value)}
              {...invalid('changedSince')} {...describedBy('changedSince', `${uid}-since-hint`)}
            />
            <p className="wg-hint" id={`${uid}-since-hint`}>{HINTS.changedSince}</p>
            {errLine('changedSince')}
          </div>
        </div>
      </div>

      <CodeBlock label="curl" title="Request builder: curl" code={curl} />
      <CodeBlock label="JavaScript" title="Request builder: fetch" code={fetchCode} />

      <div className="wg-actions">
        <button type="button" className="wg-reset" onClick={() => { setS(INITIAL); setOpen(false) }}>Reset</button>
        <p className="wg-note">This is a single request. To fetch repeatedly, see <Link to={{ hash: '#polling' }}>Polling and caching</Link>.</p>
      </div>
    </div>
  )
}
