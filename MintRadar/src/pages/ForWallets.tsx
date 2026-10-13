import { useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { useHashScroll, useNavbarOffset } from '@/hooks/useDocPageScroll'
import { CodeBlock } from '@/components/CodeBlock'
import { CONTACT_NIP05, CONTACT_NPUB, REPO_URL } from '@/constants/contact'
import {
  WALLET_API_BASE, WALLET_API_FACTS as F, WALLET_EXAMPLES, DOCS_API_URL, DOCS_OPENAPI_URL,
} from '@/constants/forWalletsPage'
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
              <strong>Use the ETag.</strong> Every successful answer has a strong <code>ETag</code>. Send it back in{' '}
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
              without credentials. <code>ETag</code>, <code>Retry-After</code> and the <code>X-RateLimit-*</code> headers are
              readable from browser code. A preflight is answered with <code>204</code> and does not count against the limit.
            </li>
            <li>
              <strong>Rate limit:</strong> {F.rateLimitPerMinute} requests per minute per IP address on{' '}
              <code>/api/wallets/*</code> (its own counter). Answers carry <code>X-RateLimit-Limit</code>,{' '}
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
            <code>count</code> and <code>mints</code>; a single mint returns <code>methodology</code>,{' '}
            <code>generatedAt</code> and <code>mint</code>.
          </p>
          <FieldTable fields={WALLET_ENVELOPE_FIELDS} label="Envelope fields" />
          <h3 className="doc-h3">The mint object</h3>
          <p>
            Fields of a nested object are written <code>parent.child</code>. Clients must ignore fields they do not know.
            The answers never contain IP addresses or other network data, reviewer keys or review texts, or contact
            details.
          </p>
          <FieldTable fields={WALLET_MINT_FIELDS} label="Mint object fields" />
        </section>

        <section aria-labelledby="filters">
          <h2 id="filters" tabIndex={-1} className="about-h2">Filters</h2>
          <p>
            All parameters of the list are optional. A present but invalid value is a <code>400</code>; unknown
            parameters are ignored. Order: <code>score</code> descending (<code>null</code> last), then{' '}
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
            <li>Inside v1 a field is never renamed or removed, and its type does not change. Changes are additive: new fields and new optional parameters.</li>
            <li>A deprecation is announced with <code>Deprecation</code> and <code>Sunset</code> response headers at least {F.deprecationNoticeDays} days before anything is removed.</li>
            <li>
              <code>methodology</code> is an integer (currently {METHODOLOGY_VERSION}) that changes whenever the score
              formula changes. Scores of different numbers are not comparable. The rules and their history are on the{' '}
              <Link to="/methodology">methodology page</Link>.
            </li>
          </ul>
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
