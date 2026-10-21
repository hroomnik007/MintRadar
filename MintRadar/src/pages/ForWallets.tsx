import { useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { useHashScroll, useNavbarOffset } from '@/hooks/useDocPageScroll'
import { CodeBlock } from '@/components/CodeBlock'
import { CONTACT_NIP05, CONTACT_NPUB, REPO_URL } from '@/constants/contact'
import {
  WALLET_API_BASE, WALLET_API_FACTS as F, WALLET_EXAMPLES, DOCS_API_URL, DOCS_OPENAPI_URL,
} from '@/constants/forWalletsPage'
import {
  ATTESTATION_NIP05, ATTESTATION_PUBKEY_HEX, ATTESTATION_RELAYS_PUBLIC, HEALTH_ASSERTION_TAGS,
} from '@/utils/healthAssertionConstants'
import {
  ATTESTATION_NPUB, HEALTH_FACTS, HEALTH_FILTER_ALL, HEALTH_FILTER_ONE, HEALTH_SECTION_ID, HEALTH_SECTION_TITLE,
  HEALTH_EXAMPLE_URL, HEALTH_SPEC_URL, HEALTH_SPEC_TAGS_URL,
} from '@/constants/healthAssertionPage'
import { VERIFY_HEALTH_FILE_NAME, VERIFY_HEALTH_INSTALL, VERIFY_HEALTH_RUNTIME_SENTENCE, VERIFY_HEALTH_SNIPPET } from '@/constants/verifyHealthSnippet'
import { METHODOLOGY_VERSION } from '@/utils/methodology'
import { PAGE_META } from '@/utils/pageMeta'
import {
  WALLET_ENVELOPE_FIELDS, WALLET_MINT_FIELDS, WALLET_QUERY_PARAMS, WALLET_ERRORS, type WalletField,
} from '@/utils/walletFields'
import './About.css'
import './DocPage.css'

// A static page: it fetches nothing from the API and makes no request of its own. The field tables come from
// utils/walletFields.ts (compared with the real mapper in src/__tests__/forWalletsPage.test.tsx), the numbers and
// examples from constants/forWalletsPage.ts. Sources: docs/API.md "API for wallets (v1)".

const SECTIONS = [
  { id: 'quick-start', label: 'Quick start' },
  { id: 'polling', label: 'Polling and caching' },
  { id: 'cors-and-limits', label: 'CORS and limits' },
  { id: 'response', label: 'Response' },
  { id: 'filters', label: 'Filters' },
  { id: 'errors', label: 'Errors' },
  { id: 'stability', label: 'Stability' },
  { id: HEALTH_SECTION_ID, label: 'Signed assertions on Nostr' },
  { id: 'ux', label: 'Suggested UX' },
  { id: 'links', label: 'Docs and contact' },
] as const

const example = (id: string) => {
  const e = WALLET_EXAMPLES.find(x => x.id === id)
  if (!e) throw new Error(`Missing example ${id}`)
  return e
}

function FieldTable({ fields, label }: { fields: readonly WalletField[]; label: string }) {
  return (
    <div className="doc-table-wrap" tabIndex={0} role="region" aria-label={label}>
      <table className="doc-table doc-table-stack">
        <thead>
          <tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Null</th><th scope="col">Meaning</th></tr>
        </thead>
        <tbody>
          {fields.map(f => (
            <tr key={f.name} data-field={f.name}>
              <th scope="row" className="doc-nowrap"><code>{f.name}</code></th>
              <td className="doc-nowrap" data-label="Type">{f.type}</td>
              <td className="doc-nowrap" data-label="Null">{f.nullable ? 'yes' : 'no'}</td>
              <td className="doc-wide">{f.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Example({ id, label, level }: { id: string; label: string; level: 'h3' | 'h4' }) {
  const e = example(id)
  const Heading = level
  return (
    <>
      <Heading className={level === 'h3' ? 'doc-h3' : 'doc-h4'}>{e.title}</Heading>
      <CodeBlock label={label} title={e.title} code={e.code} />
    </>
  )
}

export default function ForWallets() {
  useDocumentMeta(PAGE_META['/for-wallets'].title, PAGE_META['/for-wallets'].description)
  const { hash } = useLocation()
  const pageRef = useRef<HTMLDivElement>(null)
  useNavbarOffset(pageRef)
  useHashScroll(hash)

  return (
    <div className="about-page doc-page" ref={pageRef}>
      <nav className="about-toc" aria-label="On this page">
        <p className="about-toc-title">On this page</p>
        <ul>
          {SECTIONS.map(s => (
            <li key={s.id}>
              <Link to={{ hash: `#${s.id}` }} className="about-toc-link">{s.label}</Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="about-text">
        <h1 className="about-h1">MintRadar for wallets</h1>
        <p>
          MintRadar offers wallets a small, read-only API with one compact health summary per Cashu mint, built from
          MintRadar&apos;s own probes and third-party audit data. No key and no sign-up.
        </p>
        <p className="about-note" role="note">
          Operational health signal, not solvency, not a recommendation to deposit funds. Based on MintRadar&apos;s
          probes and third-party audit data; it can be wrong or out of date.
        </p>

        <section aria-labelledby="quick-start">
          <h2 id="quick-start" tabIndex={-1} className="about-h2">Quick start</h2>
          <p>
            The base URL is <code>{WALLET_API_BASE}</code>. The same routes are served without the <code>v1</code>{' '}
            segment (<code>/api/wallets/…</code>).
          </p>
          <h3 className="doc-h3">1. List the sat mints with a score of 70 or more</h3>
          <Example level="h4" id="list-curl" label="curl" />
          <Example level="h4" id="list-fetch" label="JavaScript" />
          <p>
            By default only online, scored mints that are not on the test-mint list are returned, best score first.
          </p>
          <p data-testid="nuts-example">
            To keep only mints that declare certain NUTs, use <code>nuts</code>. For example, mints that declare NUT-11 and NUT-12:{' '}
            <code>{F.nutzapQuery}</code> (a mint is kept only when it lists all of them in its <code>/v1/info</code>; an entry with <code>&quot;supported&quot;: false</code> does not count as listed).
          </p>
          <h3 className="doc-h3">2. One mint by its URL</h3>
          <p>
            Percent-encode the whole mint URL (<code>encodeURIComponent</code>) and put it after{' '}
            <code>/wallets/mints/</code>. Replace the example with the mint URL your user holds.
          </p>
          <Example level="h4" id="one-curl" label="curl" />
          <Example level="h4" id="one-fetch" label="JavaScript" />
          <p>
            A mint that is offline, archived or on the test-mint list is returned when you ask for it by URL;{' '}
            <code>status</code> and <code>isTest</code> tell them apart.
          </p>
        </section>

        <section aria-labelledby="polling">
          <h2 id="polling" tabIndex={-1} className="about-h2">Polling and caching</h2>
          <ul>
            <li>
              <strong>Poll at most every {F.pollMinutes} minutes.</strong> The data follows MintRadar&apos;s{' '}
              {F.pollMinutes}-minute probe cycle, and every successful answer carries{' '}
              <code>Cache-Control: public, max-age={F.cacheMaxAgeSeconds}</code>. Fetching the list once at start and
              then every 10 minutes is well within the limits.
            </li>
            <li>
              <strong>Use the ETag.</strong> Every successful answer has an <code>ETag</code> (a compressed answer carries it in the weak form <code>W/&quot;…&quot;</code>; keep it as it is). Send it back in{' '}
              <code>If-None-Match</code>: while nothing changed you get <code>304 Not Modified</code> with the same
              headers and no body. A browser&apos;s HTTP cache does this for you; a server or a native app should keep
              the ETag itself.
            </li>
            <li>Error responses are not cached.</li>
          </ul>
          <Example level="h3" id="poll-fetch" label="JavaScript" />
        </section>

        <section aria-labelledby="cors-and-limits">
          <h2 id="cors-and-limits" tabIndex={-1} className="about-h2">CORS and limits</h2>
          <ul>
            <li>
              <strong>CORS:</strong> any origin may call <code>GET</code> (and <code>HEAD</code>, <code>OPTIONS</code>),
              without credentials. <code>ETag</code>, <code>Retry-After</code>, the <code>X-RateLimit-*</code> headers and, since {F.walletAdditionsOn}, <code>Deprecation</code>, <code>Sunset</code> and <code>Link</code> are
              readable from browser code. A preflight is answered with <code>204</code> and does not count against the limit.
            </li>
            <li>
              <strong>Rate limit:</strong> {F.rateLimitPerMinute} requests per minute per IP address, one counter shared by{' '}
              <code>/api/v1/wallets/*</code> and <code>/api/v1/mints/recommend</code> (the unversioned{' '}
              <code>/api/...</code> paths count the same). Answers carry <code>X-RateLimit-Limit</code>,{' '}
              <code>X-RateLimit-Remaining</code> and <code>X-RateLimit-Reset</code>; a <code>429</code> carries{' '}
              <code>Retry-After</code>. Users behind one NAT share the budget, so a wallet backend should fetch once and
              serve its users from its own cache.
            </li>
          </ul>
        </section>

        <section aria-labelledby="response">
          <h2 id="response" tabIndex={-1} className="about-h2">Response</h2>
          <p>
            Every answer is JSON in an envelope. The list returns <code>methodology</code>, <code>generatedAt</code>,{' '}
            <code>count</code>, <code>total</code>, <code>truncated</code> and <code>mints</code>; a single mint returns{' '}
            <code>methodology</code>, <code>generatedAt</code>, <code>mint</code> and <code>canonicalUrl</code>.
          </p>
          <FieldTable fields={WALLET_ENVELOPE_FIELDS} label="Envelope fields" />
          <h3 className="doc-h3">The mint object</h3>
          <p>
            Fields of a nested object are written <code>parent.child</code>. Clients must ignore fields they do not know.
            The answers never contain IP addresses, AS numbers, hosting organisations, server locations or error
            messages, reviewer keys or review texts, or contact details (<code>contactChecks</code> says only whether MintRadar recognises the format of the entries a mint lists, never a value or a domain). They do carry the mint&apos;s public NUT-06
            key (<code>pubkey</code>) and whether it advertises a Tor address (<code>hasOnion</code>). The heavier fields{' '}
            <code>keysets</code>, <code>keysetsCheckedAt</code>, <code>methods</code> and <code>scoreBreakdown</code> are
            in the list only with <code>include=</code> (so are <code>pubkey</code>, <code>firstSeenAt</code>, <code>lastOnlineAt</code>, <code>sample</code>, <code>contactChecks</code>, <code>feeExamples</code>, <code>limits</code> and <code>auditByDirection</code>, as <code>include=facts</code>) and always in the single-mint answer.{' '}
            <code>scoreBreakdown</code> is what the score used at its last computation, written together with the score.
          </p>
          <p data-testid="request-privacy">
            <strong>Privacy of your request:</strong> download the whole list and filter locally; the single-mint
            endpoint tells MintRadar which mint you asked about.
          </p>
          <FieldTable fields={WALLET_MINT_FIELDS} label="Mint object fields" />
        </section>

        <section aria-labelledby="filters">
          <h2 id="filters" tabIndex={-1} className="about-h2">Filters</h2>
          <p>
            All parameters of the list are optional. A present but invalid value is a <code>400</code> (a repeated
            parameter included; the <code>include…</code> flags take exactly <code>true</code> or <code>false</code>);
            unknown parameters are ignored. Order: <code>score</code> descending (<code>null</code> last), then{' '}
            <code>uptime7dPct</code> descending, then <code>name</code>, then <code>url</code>.
          </p>
          <div className="doc-table-wrap" tabIndex={0} role="region" aria-label="List parameters">
            <table className="doc-table doc-table-stack">
              <thead>
                <tr><th scope="col">Parameter</th><th scope="col">Type</th><th scope="col">Default</th><th scope="col">Meaning</th></tr>
              </thead>
              <tbody>
                {WALLET_QUERY_PARAMS.map(p => (
                  <tr key={p.name} data-param={p.name}>
                    <th scope="row" className="doc-nowrap"><code>{p.name}</code></th>
                    <td className="doc-nowrap" data-label="Type">{p.type}</td>
                    <td className="doc-nowrap" data-label="Default"><code>{p.default}</code></td>
                    <td className="doc-wide">{p.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="errors">
          <h2 id="errors" tabIndex={-1} className="about-h2">Errors</h2>
          <p>Errors are JSON with a stable <code>code</code> and a human <code>message</code>:</p>
          <CodeBlock
            label="JSON"
            title="Error body"
            code={'{ "error": { "code": "invalid_parameter", "message": "minScore must be an integer from 0 to 100" } }'}
          />
          <div className="doc-table-wrap" tabIndex={0} role="region" aria-label="Error codes">
            <table className="doc-table doc-table-stack">
              <thead>
                <tr><th scope="col">Status</th><th scope="col">Code</th><th scope="col">When</th></tr>
              </thead>
              <tbody>
                {WALLET_ERRORS.map(e => (
                  <tr key={e.code} data-code={e.code}>
                    <th scope="row" className="doc-nowrap">{e.status}</th>
                    <td className="doc-nowrap" data-label="Code"><code>{e.code}</code></td>
                    <td className="doc-wide">{e.when}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>A <code>429</code> also carries <code>retryAfterSec</code> in the error object.</p>
        </section>

        <section aria-labelledby="stability">
          <h2 id="stability" tabIndex={-1} className="about-h2">Stability</h2>
          <ul>
            <li>Inside v1 a field is never renamed or removed, and its type does not change. Changes are additive: new fields and new optional parameters. The list parameters <code>nuts</code> and <code>eligible</code> (added {F.recommendDeprecatedOn}) are such additions.</li>
            <li data-testid="additions">
              Added {F.walletAdditionsOn} (nothing renamed, removed or changed): the list parameters <code>method</code>, <code>maxInputFeePpk</code> and{' '}
              <code>include</code>; the list fields <code>total</code> and <code>truncated</code>; the single-mint field <code>canonicalUrl</code> (a path that differs only in letter
              case can now answer <code>200</code> instead of <code>404</code> when exactly one mint matches); the mint fields <code>pubkey</code>, <code>firstSeenAt</code>,{' '}
              <code>lastOnlineAt</code>, <code>downSince</code>, <code>hasOnion</code>, <code>authRequired</code>, <code>sample</code>, <code>auditNeutralReason</code>,{' '}
              <code>keysets</code>, <code>keysetsCheckedAt</code>, <code>methods</code> and <code>scoreBreakdown</code>; and the exposed CORS headers <code>Deprecation</code>, <code>Sunset</code> and <code>Link</code>.
            </li>
            <li data-testid="additions-changes">
              Also added {F.walletAdditionsOn}, with the mint change log: the mint field <code>changes</code> (on the single-mint endpoint, and in the list with <code>include=changes</code>), the list
              parameter <code>changedSince</code> and the <code>include</code> value <code>changes</code>. The default list is unchanged. The signed health event gets one more tag, <code>mint_last_change</code>,
              only for a mint that has a recorded change.
            </li>
            <li data-testid="additions-contact-checks">
              Also added {F.walletAdditionsOn}: the mint field <code>contactChecks</code> (on the single-mint endpoint, and in the list with <code>include=facts</code>): per contact entry the kind, whether MintRadar recognises the format of the value (<code>formatValid: false</code> means &quot;format not recognised by MintRadar&quot;, not that the contact is wrong),
              whether the domain of an e-mail address or of a NIP-05 style Nostr name has mail or address records in DNS (<code>null</code> when that is unknown; the name itself is never looked up) and when it was checked. The default list is unchanged.
            </li>
            <li data-testid="additions-fees-limits">
              Also added {F.walletFactsAddedOn}: the mint fields <code>feeExamples</code>, <code>limits</code> and <code>auditByDirection</code> (on the single-mint endpoint, and in the list with <code>include=facts</code>).
              <code>feeExamples</code> gives the input fee in plain amounts per unit, for spending 1, 16 and 100 proofs (NUT-02, rounded up), computed from the stored keysets. <code>limits</code> is what the mint declares in its <code>/v1/info</code> for deposits (NUT-04) and withdrawals (NUT-05); a limit it does not declare is <code>null</code>, and Lightning fee reserves are not included because they are only known when a quote is requested.
              <code>auditByDirection</code> splits cashu.info&apos;s last 7 days into deposits (<code>mint</code>) and withdrawals (<code>melt</code>), with attempts, failures and the time MintRadar stored them; the score uses the combined number. The default list is unchanged.
            </li>
            <li>A removal is announced on this page and in <code>docs/API.md</code> at least {F.deprecationNoticeDays} days before it takes effect. A route that is going away also says so in its responses, with the <code>Deprecation</code> and <code>Sunset</code> headers and a <code>Link</code> header with <code>rel=&quot;successor-version&quot;</code>; the only route that does so today is the one below.</li>
            <li data-testid="recommend-deprecation">
              <strong>Deprecated: <code>GET /api/v1/mints/recommend</code></strong> (and <code>/api/mints/recommend</code>), since {F.recommendDeprecatedOn}. It may be removed from {F.recommendSunsetOn} on; until then it answers as before.
              Replacement: <code>{F.recommendReplacementQuery}</code> returns the same mints in the same order (the defaults of <code>/mints/recommend</code> are <code>unit=sat</code>, <code>minScore=80</code>, <code>limit=5</code>; add <code>nuts=4,5</code> for its <code>nuts</code> filter).
              The list route has a larger <code>limit</code> range and the stable wallet object.
            </li>
            <li>
              <code>methodology</code> is an integer (currently {METHODOLOGY_VERSION}) that changes whenever the score
              formula changes. Scores of different numbers are not comparable. The rules and their history are on the{' '}
              <Link to="/methodology">methodology page</Link>.
            </li>
          </ul>
        </section>

        <section aria-labelledby={HEALTH_SECTION_ID}>
          <h2 id={HEALTH_SECTION_ID} tabIndex={-1} className="about-h2">{HEALTH_SECTION_TITLE}</h2>
          <p className="about-note" role="note" data-testid="early-version-notice">
            <strong>Early version.</strong> The <code>mint_*</code> tags are MintRadar&apos;s own tags: NIP-85 defines the
            tags <code>rank</code>, <code>comment_cnt</code> and <code>reaction_cnt</code> for kind 30385, and any other
            tag is agreed between a provider and its clients. The format may change before it is frozen. Changes are
            announced on this page and in <a href={HEALTH_SPEC_URL} target="_blank" rel="noopener noreferrer">the
            spec</a>, and every event carries the <code>methodology</code> integer.
          </p>

          <h3 className="doc-h3">What it is</h3>
          <p>
            The same operational health signal as the API above, published as signed Nostr events (kind 30385, one per
            mint) so that a wallet can verify it without relying on a server of ours. It is not solvency and not advice.
          </p>

          <h3 className="doc-h3">Who publishes it</h3>
          <p>
            The events are signed by the MintRadar Health key. <strong>Pin this public key in your wallet&apos;s code</strong>{' '}
            and ignore events signed by any other key. You can confirm it once through NIP-05:{' '}
            <code>{ATTESTATION_NIP05}</code> (<code>https://mintradar.org/.well-known/nostr.json?name=health</code>).
          </p>
          <CodeBlock label="npub" title="MintRadar Health public key (npub)" code={ATTESTATION_NPUB} />
          <CodeBlock label="hex" title="MintRadar Health public key (hex)" code={ATTESTATION_PUBKEY_HEX} />

          <h3 className="doc-h3">Relays</h3>
          <ul data-testid="health-relays">
            {ATTESTATION_RELAYS_PUBLIC.map(r => <li key={r}><code>{r}</code></li>)}
          </ul>
          <p>Query them together: a relay can be unreachable or can have dropped an event.</p>

          <h3 className="doc-h3">Query</h3>
          <p>
            One query returns one event per scored mint, each about 1 kB, so a limit of {HEALTH_FACTS.queryLimit} is
            plenty.
          </p>
          <CodeBlock label="Filter" title="Filter for every mint" code={HEALTH_FILTER_ALL} />
          <p>
            For a single mint add <code>&quot;#d&quot;</code> with the normalised mint URL (rules below):
          </p>
          <CodeBlock label="Filter" title="Filter for one mint" code={HEALTH_FILTER_ONE} />

          <h3 className="doc-h3">Tags</h3>
          <div className="doc-table-wrap" tabIndex={0} role="region" aria-label="Tags of a health assertion">
            <table className="doc-table doc-table-stack">
              <thead>
                <tr>
                  <th scope="col">Tag</th><th scope="col">Value</th><th scope="col">Defined by</th>
                  <th scope="col">When present</th><th scope="col">Meaning</th>
                </tr>
              </thead>
              <tbody>
                {HEALTH_ASSERTION_TAGS.map(t => (
                  <tr key={t.name} data-tag={t.name}>
                    <th scope="row" className="doc-nowrap"><code>{t.name}</code></th>
                    <td data-label="Value">{t.type}</td>
                    <td data-label="Defined by">{t.source === 'MintRadar' ? 'MintRadar tag' : `defined by ${t.source}`}</td>
                    <td data-label="When present">{t.presence}</td>
                    <td className="doc-wide">{t.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            The <code>mint_*</code> tags are the measurements; <code>rank</code> is the score derived from them by the
            method of the <code>methodology</code> version. The score is a health signal, not solvency and not a
            recommendation. Clients must ignore tags they do not know. The format is open: any monitor may publish
            events of this shape under its own key.
          </p>

          <h3 className="doc-h3">Updates and expiry</h3>
          <ul>
            <li>
              Every event expires {HEALTH_FACTS.expiryHours} hours after it was created (the <code>expiration</code> tag).
              Check it yourself: a relay can keep an expired event.
            </li>
            <li>
              For each mint a new event is published at most every {HEALTH_FACTS.minIntervalHours} hours, if the
              score changed by at least {HEALTH_FACTS.minRankDelta} points or the methodology changed. A mint whose event
              is {HEALTH_FACTS.refreshHours} hours old gets a new one anyway, so the expiry does not lapse.
            </li>
            <li data-testid="health-state-change-rule">
              <strong>A change of <code>mint_status</code></strong> (for example online to degraded) does not wait for those{' '}
              {HEALTH_FACTS.minIntervalHours} hours: it is published at the next run of the publisher, which runs every{' '}
              {HEALTH_FACTS.runIntervalMinutes} minutes. Limits: at least {HEALTH_FACTS.stateChangeMinGapMinutes} minutes
              between two events of one mint, and at most {HEALTH_FACTS.stateChangeMaxPerHour} such events per hour for all
              mints. A change over the limit waits for the next run; none is dropped.
            </li>
          </ul>

          <h3 className="doc-h3">What is published and what is not</h3>
          <ul>
            <li><strong>Published:</strong> mints that have a score and are not archived. An offline mint is published with <code>mint_status</code> <code>offline</code>; a test mint with <code>mint_test</code> <code>1</code>.</li>
            <li><strong>Not published:</strong> mints without a score, archived mints, and mints whose URL is an onion or an IP address. The last event of a mint that drops out expires after {HEALTH_FACTS.expiryHours} hours.</li>
          </ul>

          <h3 className="doc-h3">How to verify</h3>
          <p>
            For each event: check the signature, check that the author is the pinned key, check that <code>d</code> equals
            <em> your own</em> normalisation of the mint URL, check that <code>expiration</code> is in the future, and
            take the event with the newest <code>created_at</code>. A missing or expired event means{' '}
            <strong>unknown</strong>, not a bad mint. Read <code>methodology</code> before you compare scores. Save the
            code below as <code>{VERIFY_HEALTH_FILE_NAME}</code> and run it. It does all of this, reads each relay on its
            own (an unreachable relay is reported and skipped) and imports nothing but <code>nostr-tools</code>.{' '}
            {VERIFY_HEALTH_RUNTIME_SENTENCE}
          </p>
          <CodeBlock label="Install and run" title="Install nostr-tools and run the example" code={VERIFY_HEALTH_INSTALL} />
          <CodeBlock label="JavaScript" title="Verify a health assertion (JavaScript, nostr-tools)" code={VERIFY_HEALTH_SNIPPET} />
          <ul>
            <li><a href={HEALTH_EXAMPLE_URL} target="_blank" rel="noopener noreferrer">docs/examples/verify-health.mjs</a>: the same code as the block above, as a file.</li>
            <li><a href={HEALTH_SPEC_URL} target="_blank" rel="noopener noreferrer">docs/nostr-health-assertions.md</a>: the specification.</li>
          </ul>
          <p>
            URL normalisation: https, lower-case host, no default port, no trailing slash on a bare host and no fragment.
            Examples for each rule are in the <a href={HEALTH_SPEC_TAGS_URL} target="_blank" rel="noopener noreferrer">tag table of the spec</a>.
          </p>

          <h3 className="doc-h3">Disclaimer</h3>
          <p>
            Operational health signal, not solvency, not a recommendation to deposit funds. Based on MintRadar&apos;s probes
            and third-party audit data; it can be wrong or out of date.
          </p>

          <h3 className="doc-h3">Key rotation</h3>
          <p>
            A new key would be announced on this page, in the profile of MintRadar Health and in the NIP-05 entry. Events of
            a retired key simply expire within {HEALTH_FACTS.expiryHours} hours.
          </p>
        </section>

        <section aria-labelledby="ux">
          <h2 id="ux" tabIndex={-1} className="about-h2">Suggested UX</h2>
          <ul>
            <li>Show the score with its label as <strong>operational health</strong> (for example &quot;Operational health 92/100&quot;), never as &quot;safe&quot; or &quot;trusted&quot;.</li>
            <li>Treat a <code>null</code> score as <strong>no data yet</strong>, not as a bad score.</li>
            <li>Hide test mints (<code>isTest: true</code>); the default list already leaves them out.</li>
            <li>Show <code>status</code> next to the score, and a short hint while <code>scoreCappedNew</code> is true.</li>
            <li>Filter by the <code>unit</code> your wallet holds.</li>
            <li>Show <code>name</code> and <code>software</code> as plain text: they come from the mints and are untrusted.</li>
            <li>Never present the score as a recommendation to deposit funds, and link people to the methodology.</li>
          </ul>
        </section>

        <section aria-labelledby="links">
          <h2 id="links" tabIndex={-1} className="about-h2">Docs and contact</h2>
          <ul>
            <li><a href={DOCS_API_URL} target="_blank" rel="noopener noreferrer">docs/API.md</a>: the full API description.</li>
            <li><a href={DOCS_OPENAPI_URL} target="_blank" rel="noopener noreferrer">docs/openapi/wallets-v1.yaml</a>: the OpenAPI 3.1 description.</li>
            <li><Link to="/methodology">Reliability Score methodology</Link>: how the score is computed, with its change log.</li>
          </ul>
          <p>Questions, a mistake in a score, or a field you need:</p>
          <div className="about-card" role="group" aria-label="Contact">
            <dl>
              <div><dt>Nostr</dt><dd>{CONTACT_NPUB}</dd></div>
              <div><dt>NIP-05</dt><dd>{CONTACT_NIP05}</dd></div>
              <div>
                <dt>Bugs and ideas</dt>
                <dd><a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">GitHub issues</a></dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
    </div>
  )
}
