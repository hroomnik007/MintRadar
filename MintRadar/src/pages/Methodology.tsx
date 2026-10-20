import { useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { useHashScroll, useNavbarOffset } from '@/hooks/useDocPageScroll'
import { PROBE_LOCATION } from '@/constants/probeLocation'
import { METHODOLOGY_PAGE as M } from '@/constants/methodologyPage'
import { CONTACT_NIP05, CONTACT_NPUB, REPO_URL } from '@/constants/contact'
import { METHODOLOGY_CHANGES, METHODOLOGY_VERSION } from '@/utils/methodology'
import { PAGE_META } from '@/utils/pageMeta'
import './About.css'
import './DocPage.css'

// Every number on this page comes from METHODOLOGY_PAGE (constants/methodologyPage.ts), which
// src/__tests__/methodologyPage.test.ts compares with the code that computes the score. The change log is
// rendered from METHODOLOGY_CHANGES. Sources: docs/claude/scoring-and-probing.md ("Methodology page").

const SECTIONS = [
  { id: 'what-it-is', label: 'What the score is' },
  { id: 'components', label: 'Components' },
  { id: 'caps-and-gates', label: 'Caps and gates' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'sources', label: 'Data sources' },
  { id: 'not-measured', label: 'Not measured' },
  { id: 'change-log', label: 'Change log' },
  { id: 'where-published', label: 'Where the score is published' },
  { id: 'report-an-error', label: 'Report an error' },
] as const

/** The change log, newest first. */
const CHANGES_NEWEST_FIRST = [...METHODOLOGY_CHANGES].sort((a, b) => b.version - a.version)

const nutLabel = (key: string): string => `NUT-${key.padStart(2, '0')}`

export default function Methodology() {
  useDocumentMeta(PAGE_META['/methodology'].title, PAGE_META['/methodology'].description)
  const { hash } = useLocation()
  const pageRef = useRef<HTMLDivElement>(null)
  useNavbarOffset(pageRef)
  useHashScroll(hash)

  const current = CHANGES_NEWEST_FIRST.find(c => c.version === METHODOLOGY_VERSION) ?? CHANGES_NEWEST_FIRST[0]
  const w = M.weights
  const v = M.version

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
        <h1 className="about-h1">How the Reliability Score is computed</h1>
        <p className="about-updated" data-testid="methodology-version">
          Methodology version {METHODOLOGY_VERSION}
          {current ? `, last changed ${current.date}` : ''}
        </p>
        <p>
          This page is the reference for the number MintRadar shows as a mint&apos;s Reliability Score. It is written
          from the code that computes the score; when the formula changes, this page and its{' '}
          <a href="#change-log">change log</a> change in the same release.
        </p>

        <section aria-labelledby="what-it-is">
          <h2 id="what-it-is" tabIndex={-1} className="about-h2">What the score is, and what it is not</h2>
          <p>
            The Reliability Score is a number from 0 to 100 that summarises how well a mint is <strong>operating</strong>,
            from MintRadar&apos;s own probes and from third-party audit data. It is an operational health signal.
          </p>
          <p className="about-note" role="note">
            It is not solvency, not proof of reserves, not a statement about who runs the mint, and not a
            recommendation to deposit funds. It can be wrong or out of date.
          </p>
          <p>
            A mint can score 100 and still lose your funds. The <Link to="/learn/how-to-choose-a-mint">Learn module on
            choosing a mint</Link> explains how to limit that risk.
          </p>
        </section>

        <section aria-labelledby="components">
          <h2 id="components" tabIndex={-1} className="about-h2">The five components</h2>
          <p>
            The score is the sum of five components. Each component is rounded to whole points on its own (the neutral
            audit value of {M.audit.neutral} is the one exception), the sum is rounded once and limited to 100, and the
            cap for new mints is applied last.
          </p>
          <div className="doc-table-wrap" tabIndex={0} role="region" aria-label="Components and maximum points">
            <table className="doc-table">
              <thead>
                <tr><th scope="col">Component</th><th scope="col">Maximum</th><th scope="col">Input</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">Uptime</th><td>{w.uptime}</td><td>MintRadar probes of the last {M.uptime.windowHours} hours</td></tr>
                <tr><th scope="row">Audit reliability</th><td>{w.audit}</td><td>cashu.info swaps of the last {M.audit.windowDays} days</td></tr>
                <tr><th scope="row">NUT support</th><td>{w.nuts}</td><td>NUTs the mint says it supports in <code>/v1/info</code></td></tr>
                <tr><th scope="row">Software version</th><td>{w.version}</td><td>The version the mint reports, against the newest stable release</td></tr>
                <tr><th scope="row">Contact</th><td>{w.contact}</td><td>Contact channels the mint publishes</td></tr>
              </tbody>
            </table>
          </div>

          <h3 className="doc-h3">Uptime ({w.uptime} points)</h3>
          <p>
            Every {M.cadence.probeMinutes} minutes the server in {PROBE_LOCATION} requests the mint&apos;s{' '}
            <code>/v1/info</code> ({M.cadence.probeTimeoutSeconds} second timeout, one retry after a network
            failure). A probe counts as successful only if the answer is a 2xx response with a valid JSON body
            in which <code>nuts</code> is an object. Uptime is the share of successful probes among all probes of the last{' '}
            {M.uptime.windowHours} hours, rounded to a whole percent; the component is that percentage times{' '}
            {M.uptime.factor.toFixed(2)}, rounded to a whole number. A mint with no probe in the window scores
            100 % if the probe now succeeds and 0 % if it fails.
          </p>

          <h3 className="doc-h3">Audit reliability ({w.audit} points)</h3>
          <p>
            Input: the stored cashu.info detail of the mint. The error rate is the number of swaps in the last{' '}
            {M.audit.windowDays} days whose failure cashu.info attributes to <em>the mint itself</em> (
            <code>errorsBlamed</code>) divided by all swaps of that window. Failures cashu.info does not blame on the
            mint are not counted. By default that includes Lightning routing failures, which can sit anywhere on the
            path; cashu.info blames a mint for them only when payments to or from it keep failing across several
            counterparts. Attempts the auditor stops itself before sending anything (too little balance, an amount
            outside the mint&apos;s limits) are not swaps and are not in the total. A count above the total is limited
            to the total.
          </p>
          <div className="doc-table-wrap" tabIndex={0} role="region" aria-label="Audit bands">
            <table className="doc-table">
              <thead>
                <tr><th scope="col">Error rate</th><th scope="col">Points</th></tr>
              </thead>
              <tbody>
                {M.audit.bands.map(b => (
                  <tr key={b.label}><th scope="row">{b.label}</th><td>{b.points}</td></tr>
                ))}
                <tr>
                  <th scope="row">No usable data</th>
                  <td>{M.audit.neutral} (neutral)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            The score is <strong>neutral, {M.audit.neutral} of {w.audit}</strong>, instead of a penalty when the mint has
            fewer than {M.audit.minSwaps} swaps in the window, when there is no cashu.info data for it, or when the
            stored data is older than {M.audit.maxAgeHours} hours ({M.audit.windowDays} days).
          </p>

          <h3 className="doc-h3">NUT support ({w.nuts} points)</h3>
          <p>
            The number of the {M.nuts.tracked.length} tracked NUTs that the mint lists in its <code>/v1/info</code>,
            divided by {M.nuts.tracked.length}, times {w.nuts}, rounded. Tracked:{' '}
            {M.nuts.tracked.map(nutLabel).join(', ')}. Not counted: the NUTs every mint implements (NUT-00 to NUT-03
            and NUT-06), NUTs that only wallets use, authentication (NUT-21, NUT-22) and the payment-method NUTs
            (NUT-23, NUT-25, NUT-30).
          </p>

          <h3 className="doc-h3">Software version ({w.version} points)</h3>
          <p>
            Compared with the newest <strong>stable</strong> release of the same software, for{' '}
            {v.families.join(' and ')}. A mint that is {v.outdatedFromMinorsBehind} or more minor versions behind
            is <strong>outdated</strong>; zero or one behind scores the full {w.version} points.
          </p>
          <div className="doc-table-wrap" tabIndex={0} role="region" aria-label="Version points">
            <table className="doc-table">
              <thead>
                <tr><th scope="col">Minor versions behind</th><th scope="col">Points</th><th scope="col">Label</th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">0</th><td>{v.pointsByMinorsBehind[0]}</td><td>latest (stable versions only)</td></tr>
                <tr><th scope="row">1</th><td>{v.pointsByMinorsBehind[1]}</td><td>none</td></tr>
                <tr><th scope="row">2</th><td>{v.pointsByMinorsBehind[2]}</td><td>outdated</td></tr>
                <tr><th scope="row">3</th><td>{v.pointsByMinorsBehind[3]}</td><td>outdated</td></tr>
                <tr><th scope="row">4</th><td>{v.pointsByMinorsBehind[4]}</td><td>outdated</td></tr>
                <tr><th scope="row">5 or more, or a lower major version</th><td>{v.pointsFiveOrMoreBehind}</td><td>outdated</td></tr>
              </tbody>
            </table>
          </div>
          <ul>
            <li>A pre-release (such as a release candidate) counts as its base version and is never called outdated against a stable version of its own minor line.</li>
            <li>A higher version than the newest known release counts as current.</li>
            <li>Software MintRadar does not recognise scores {v.pointsUnknownSoftware} points, a recognised software with a version that cannot be read {v.pointsUnreadableVersion}, and a mint that reports no version {v.pointsNoVersion}. A recognised family for which no newest release is known also scores {v.pointsUnknownSoftware}.</li>
            <li>
              <strong>Where &quot;newest&quot; comes from:</strong> the latest non-draft, non-pre-release GitHub
              release of Nutshell and of cdk, refreshed once a day. A new release counts as the newest only{' '}
              {v.releaseGraceDays} days after it was published (until then the previous release is used), so operators
              have time to upgrade. Without a catalog value, the highest stable version that at least{' '}
              {v.fallbackMinMints} different tracked mints report exactly is used; with none, the family has no
              reference.
            </li>
          </ul>

          <h3 className="doc-h3">Contact ({w.contact} points)</h3>
          <p>
            The number of contact entries the mint publishes in <code>/v1/info</code> with the method email, Twitter or
            Nostr, limited to {M.contact.maxChannels}, divided by {M.contact.maxChannels}, times {w.contact}, rounded.
            This is what the operator says about itself; MintRadar does not verify it, which is why it carries the
            smallest weight. When a probe cannot read <code>/v1/info</code>, the last known count is used.
          </p>
        </section>

        <section aria-labelledby="caps-and-gates">
          <h2 id="caps-and-gates" tabIndex={-1} className="about-h2">Caps and gates</h2>
          <ul>
            <li>
              <strong>New mints are capped at {M.newMint.capPoints}.</strong> For the first {M.newMint.capDays} days after
              MintRadar first saw a mint, its score is the lower of the computed sum and {M.newMint.capPoints}. The wallet
              API marks this with <code>scoreCappedNew</code>.
            </li>
            <li>
              <strong>Recommendations need {M.recommendation.minAgeDays} days.</strong> A mint is eligible to appear in a
              recommendation (the top lists and the wallet API&apos;s <code>eligibleForRecommendation</code>) only when it
              was first seen at least {M.recommendation.minAgeDays} days ago, is online and has a score.
            </li>
            <li><strong>Test mints are never recommended.</strong> Mints on MintRadar&apos;s manual test-mint list are marked and excluded.</li>
          </ul>
        </section>

        <section aria-labelledby="reviews">
          <h2 id="reviews" tabIndex={-1} className="about-h2">Reviews are separate</h2>
          <p>
            People&apos;s reviews (NIP-87, from Nostr) form the separate <strong>Community Rating</strong>. It is never
            part of the Reliability Score and the score never changes because of a review. Reviews written by a
            mint&apos;s own operator are labelled and not counted in the Community Rating. MintRadar does not verify
            reviewers.
          </p>
        </section>

        <section aria-labelledby="sources">
          <h2 id="sources" tabIndex={-1} className="about-h2">Data sources and cadence</h2>
          <div className="doc-table-wrap" tabIndex={0} role="region" aria-label="Data sources">
            <table className="doc-table doc-table-stack">
              <thead>
                <tr><th scope="col">Source</th><th scope="col">How often</th><th scope="col">When it is missing or old</th></tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">MintRadar probe of <code>/v1/info</code> from {PROBE_LOCATION}</th>
                  <td data-label="How often">Every {M.cadence.probeMinutes} minutes</td>
                  <td>A failed probe counts as offline in uptime. NUT count, software version and contact count keep their last known values.</td>
                </tr>
                <tr>
                  <th scope="row">cashu.info per-mint detail (swaps of the last {M.audit.windowDays} days)</th>
                  <td data-label="How often">Every {M.cadence.detailMinutes} minutes</td>
                  <td>No data, fewer than {M.audit.minSwaps} swaps, or data older than {M.audit.maxAgeHours} hours: neutral {M.audit.neutral}. A failed fetch changes nothing that is stored.</td>
                </tr>
                <tr>
                  <th scope="row">GitHub releases of Nutshell and cdk</th>
                  <td data-label="How often">Once a day</td>
                  <td>The last known release is kept. Without any, the fallback above applies; without that, {v.pointsUnknownSoftware} points and no label.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            The score is recomputed after every probe, so it follows the probe cycle. Data from audit.8333.space is
            shown on the Audit tab of a mint and is not used in the score. Since a score can only be as current as these
            sources, it can lag behind what a mint is doing right now. If most mints fail from our server at the same moment and
            cashu.info sees them up, MintRadar treats that cycle as a problem on its own side and does not record the
            failures. A mint with at least 4 probes in the last 24 hours
            and none successful, or whose last probe failed more than 24 hours ago, is shown as degraded and hidden
            from the default list; its score keeps being computed by the same rules.
          </p>
        </section>

        <section aria-labelledby="not-measured">
          <h2 id="not-measured" tabIndex={-1} className="about-h2">What is not measured</h2>
          <ul>
            <li>Solvency, reserves or whether the mint can pay out everything it owes.</li>
            <li>Who runs the mint, whether the operator is trustworthy, or its legal and custody practices. Published contact details are not verified.</li>
            <li>Latency from your location. Latency is measured from {PROBE_LOCATION} and is not part of the score.</li>
            <li>Lightning liquidity and routing, and failures cashu.info does not attribute to the mint.</li>
            <li>Software quality beyond how recent the version is.</li>
            <li>Whether a mint really supports the NUTs it advertises or runs the software version it reports. MintRadar takes both, and the contact entries, from the mint&apos;s own <code>/v1/info</code>. The audit swaps exercise minting and melting; other NUTs are taken at the mint&apos;s word.</li>
            <li>What people say about the mint (see Reviews above).</li>
          </ul>
        </section>

        <section aria-labelledby="change-log">
          <h2 id="change-log" tabIndex={-1} className="about-h2">Change log</h2>
          <p>
            The methodology number goes up whenever the formula changes. Scores from different numbers are not directly
            comparable. Newest first:
          </p>
          <ol className="doc-changelog" aria-label="Methodology change log">
            {CHANGES_NEWEST_FIRST.map(c => (
              <li key={c.version} data-version={c.version}>
                <span className="doc-changelog-head">
                  <strong>Methodology {c.version}</strong>
                  <time dateTime={c.date}>{c.date}</time>
                </span>
                <span className="doc-changelog-text">{c.summary}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="where-published">
          <h2 id="where-published" tabIndex={-1} className="about-h2">Where the score is published</h2>
          <p>
            The <Link to="/for-wallets">wallet API</Link> returns the score as <code>score</code>. MintRadar also
            publishes it as signed health assertions on Nostr (an early version): the <code>rank</code> tag of each event
            carries the score, and the <code>methodology</code> tag carries the number at the top of this page, currently{' '}
            {METHODOLOGY_VERSION}. How to read and verify them:{' '}
            <Link to="/for-wallets#signed-health-assertions">signed health assertions on the wallets page</Link>.
          </p>
        </section>

        <section aria-labelledby="report-an-error">
          <h2 id="report-an-error" tabIndex={-1} className="about-h2">Report an error</h2>
          <p>
            If a score looks wrong, or this page does not match what you observe, tell us. Please include the mint URL
            and the time you looked.
          </p>
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
          <p className="doc-after-card">
            Wallet developers can read the score, and the fields it is built from, through the{' '}
            <Link to="/for-wallets">API for wallets</Link>. Every answer of that API carries the methodology number above.
          </p>
        </section>
      </div>
    </div>
  )
}
