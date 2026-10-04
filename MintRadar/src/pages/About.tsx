import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useDocumentMeta } from '@/hooks/useDocumentMeta'
import { PROBE_LOCATION } from '@/constants/probeLocation'
import './About.css'

// Every factual statement on this page is mapped to its source in
// docs/claude/privacy-and-about.md — update both together (see the rule there).

const REPO_URL = 'https://github.com/hroomnik007/MintRadar'
const NPUB = 'npub1zatej55x47xzhnw06yarqr5ugz7y5el8vygcckek24e5qmrtx77qnmd6rg'
const NIP05 = 'wildcitizen7@mintradar.org'
const LAST_UPDATED = '4 October 2026'

const SECTIONS = [
  { id: 'about', label: 'About' },
  { id: 'privacy', label: 'Your data' },
  { id: 'terms', label: 'Rules' },
] as const

// Scrolls the element named by the URL hash into view and moves keyboard focus to it. The
// AppShell resets the scroll to the top on every pathname change from an effect that runs
// AFTER this page's effects (parent effects run last), so the scroll waits one frame; it is
// repeated once the web fonts are in because they re-wrap the text above the target.
function useHashScroll(hash: string): void {
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (!id) return
    let cancelled = false
    const go = (focus: boolean): void => {
      if (cancelled) return
      const el = document.getElementById(id)
      if (!el) return
      el.scrollIntoView({ block: 'start' })
      if (focus) el.focus({ preventScroll: true })
    }
    const raf = requestAnimationFrame(() => go(true))
    void document.fonts?.ready.then(() => go(false))
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [hash])
}

// The sticky navbar is 51px on desktop, 86px on phones and 117px at ~320px (its tabs wrap), so a
// fixed scroll-margin would leave headings under it. Keep --about-scroll-offset equal to the real
// navbar height + a gap; the CSS fallback covers the first paint.
function useNavbarOffset(pageRef: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.navbar')
    const page = pageRef.current
    if (!nav || !page) return
    const apply = (): void => { page.style.setProperty('--about-scroll-offset', `${nav.offsetHeight + 16}px`) }
    apply()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(apply)
    ro.observe(nav)
    return () => ro.disconnect()
  }, [pageRef])
}

export default function About() {
  useDocumentMeta(
    'About and privacy | MintRadar',
    'What MintRadar is, how it measures Cashu mints, what data it keeps about you and the rules of using it.',
  )
  const { hash } = useLocation()
  const pageRef = useRef<HTMLDivElement>(null)
  useNavbarOffset(pageRef)
  useHashScroll(hash)

  return (
    <div className="about-page" ref={pageRef}>
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
        <h1 className="about-h1">About MintRadar</h1>

        <section aria-labelledby="about">
          <h2 id="about" tabIndex={-1} className="about-h2">About</h2>
          <p>
            MintRadar is a free, independent monitor and directory for Cashu ecash mints. It shows two separate
            signals: how a mint is running (Reliability Score, 0 to 100: uptime 40%, audit results 25%, supported
            NUTs 15%, software version 15%, published contact information 5%; a mint we first saw less than 30 days
            ago is capped at 75), and what other people say about it (Community Rating, from NIP-87 reviews posted
            on Nostr, which we do not verify).
          </p>
          <p>
            A mint can run perfectly and still lose your funds; the <Link to="/learn">Learn section</Link> explains
            how to limit that risk.
          </p>
          <p className="about-note" role="note">
            A score is a health signal, not proof that a mint is solvent or honest
          </p>
          <p>
            <strong>How we check.</strong> Every 5 minutes our server in {PROBE_LOCATION}, Germany asks each tracked
            mint for its <code>/v1/info</code>, and once a day it also checks that the mint serves its keys
            (<code>/v1/keys</code>). Latency is measured from that server and can differ from what you see. Audit
            data comes from a third-party service (audit.8333.space) and can be out of date; when it is, we say so.
            Some mints sit behind firewalls that challenge automated requests; such a mint may work in your wallet
            and still show up here as offline, or fail to be listed.
          </p>
          <p>
            <strong>Independence.</strong> No mint pays for its position or its score, and there are no ads or
            affiliate links. The source code is open (MIT licence):{' '}
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">github.com/hroomnik007/MintRadar</a>.
          </p>
          <div className="about-card" id="contact" tabIndex={-1} role="group" aria-label="Contact">
            <dl>
              <div><dt>Nostr</dt><dd>{NPUB}</dd></div>
              <div><dt>NIP-05</dt><dd>{NIP05}</dd></div>
              <div>
                <dt>Bugs and ideas</dt>
                <dd><a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">GitHub issues</a></dd>
              </div>
              <div>
                <dt>Security</dt>
                <dd>
                  <a href={`${REPO_URL}/security/advisories/new`} target="_blank" rel="noopener noreferrer">
                    GitHub private vulnerability reporting
                  </a>{' '}
                  (see{' '}
                  <a href={`${REPO_URL}/blob/main/SECURITY.md`} target="_blank" rel="noopener noreferrer">SECURITY.md</a>)
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section aria-labelledby="privacy">
          <h2 id="privacy" tabIndex={-1} className="about-h2">Your data</h2>
          <p className="about-updated">Last updated {LAST_UPDATED}</p>
          <p>
            MintRadar is run by an individual who uses the pseudonym wildcitizen7 (contact above). We set no
            cookies, use no analytics or advertising and load no third-party scripts or fonts.
          </p>
          <ul>
            <li>
              <strong>Server logs:</strong> our web server logs your IP address, the time, the request (method and
              address, including any query string), the status, the size of the answer, the referrer, your
              browser&rsquo;s user agent and the site name you asked for. The IP address is not anonymised. Logs are
              kept about 14 days. A firewall tool (fail2ban) may temporarily ban abusive IP addresses and keeps its
              records for 1 day. We use this only to run and protect the service.
            </li>
            <li>
              <strong>Notifications (optional):</strong> if you turn them on we store your Nostr public key, the
              mint, your message relays, your settings and a timestamp. A subscription is deleted when you turn both
              alerts for that mint off, when you remove the mint from your watchlist, or about 30 days after its last
              update (logging in to MintRadar refreshes it). Logging out does not cancel a notification.
            </li>
            <li>
              <strong>Reviews</strong> are public Nostr events. We keep a copy (public key, rating, text,
              timestamps) and display it. Copies are not deleted on a schedule, and deleting a review on Nostr does
              not remove our copy.
            </li>
            <li>
              <strong>Submitting a mint</strong> stores only its address, nothing about who submitted it.
            </li>
            <li>
              <strong>Hosting:</strong> a Hetzner Cloud server in {PROBE_LOCATION}, Germany (EU). Its disk is not
              encrypted. A database backup is made every 6 hours on the same server and kept about 8 days; it is not
              encrypted and contains the data above. The provider does not currently make backups or snapshots of the
              server.
            </li>
            <li>
              <strong>In your browser</strong> we store your watchlist, notification settings and a cached copy of
              mint data (IndexedDB), your card-view choice and a list of mint icons that failed to load
              (localStorage) and, for the session only (sessionStorage), your public profile, login method and relay
              list, plus the pairing data of a remote signer until you log out or close the tab. A private key (nsec)
              stays in memory for the session only and is never stored or sent.
            </li>
            <li>
              <strong>Your browser contacts some services directly,</strong> and they see your IP address: Nostr
              relays (a few on a mint page, 17 to 18 when you are logged in), mints (the Best Mint wizard contacts up
              to 20 per run; &ldquo;Show my latency&rdquo; and the Token Inspector contact the mint you choose), the
              host of your own profile picture, cashu.me when you click &ldquo;Open in cashu.me&rdquo;, and a remote
              signer&rsquo;s pairing relays. Mint icons and NIP-05 checks go through our server. We do not load other
              people&rsquo;s profile pictures.
            </li>
            <li>
              <strong>Our Nostr relay</strong> (nostr.mintradar.org) is public: anyone can read it. MintRadar&rsquo;s
              own keys can publish any event; others can publish only mint announcements (kind 38172) and
              recommendations or reviews (kind 38000). Events are limited to 64 KiB and we configure no retention.
            </li>
          </ul>
          <p>
            Questions about the data we hold about your public key: <Link to={{ hash: '#contact' }}>contact us</Link>.
          </p>
        </section>

        <section aria-labelledby="terms">
          <h2 id="terms" tabIndex={-1} className="about-h2">Rules</h2>
          <p className="about-updated">Last updated {LAST_UPDATED}</p>
          <ul>
            <li>
              MintRadar is provided as it is, free of charge, without any warranty. It can be unavailable, wrong or
              out of date, and we may change or stop it at any time without notice.
            </li>
            <li>
              Nothing here is financial, legal, tax or investment advice. You can lose funds held in any mint: hold
              only what you can afford to lose.
            </li>
            <li>
              Reviews are the unverified opinions of their authors. We do not endorse them and may stop displaying
              unlawful or abusive content.
            </li>
            <li>Mints and wallets listed here belong to their operators; we are not affiliated with them.</li>
            <li>
              The service has rate limits and the API is unofficial and may change. Do not use the service to attack
              or overload it or other hosts.
            </li>
            <li>
              To the extent the law allows, we are not liable for losses from using MintRadar. The source code is
              under the MIT licence.
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}
