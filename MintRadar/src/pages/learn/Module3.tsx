import { Link } from 'react-router-dom'
import { ReliabilityScoreDonut } from '@/components/learn/ReliabilityScoreDonut'
import { KeyTakeaway } from '@/components/learn/KeyTakeaway'

export default function Module3() {
  return (
    <div className="learn-content">
      <h1>How to Choose a Cashu Mint</h1>

      <p>
        Now that you understand the risks, let's talk about how to actually pick a mint to use — and how MintRadar can help.
      </p>

      <h2>What to look for</h2>
      <p>
        <strong>1. Uptime.</strong> A mint that's frequently offline is one you can't rely on when you need to spend or redeem your funds. MintRadar checks every known mint every 5 minutes and tracks this over time.
      </p>
      <p>
        <strong>2. Software freshness.</strong> Mint software gets bug fixes and security improvements regularly. A mint running a very outdated version may be missing important fixes.
      </p>
      <p>
        <strong>3. NUT support — especially the security-relevant ones.</strong> "NUTs" are the individual pieces of the Cashu specification. Two are worth knowing by name:
      </p>
      <ul>
        <li><strong>NUT-09 (Restore):</strong> lets you recover your ecash from just your wallet's seed phrase, even if you lose your device. Without it, losing your phone could mean losing your funds even if the mint is fine.</li>
        <li><strong>NUT-12 (DLEQ proofs):</strong> lets your wallet cryptographically verify that the mint signed your tokens correctly, without needing to trust the mint's word for it.</li>
        <li><strong>NUT-11 (P2PK):</strong> lets you lock ecash tokens so only a specific person (holding a specific key) can spend them — useful if you want to send funds that can't be redeemed by just anyone who intercepts them.</li>
      </ul>
      <p>
        A mint missing these isn't necessarily malicious, but it does mean you're trusting it with less of a safety net.
      </p>
      <p>
        <strong>4. Operator transparency.</strong> Does the mint publish contact information? Is there a real person or team behind it who can be reached? Anonymous mints aren't automatically untrustworthy, but a mint with no way to reach the operator is one you're trusting on faith alone.
      </p>

      <h2>How MintRadar's Reliability Score works</h2>
      <p>
        MintRadar combines several of these signals into a single Reliability Score out of 100:
      </p>

      <ReliabilityScoreDonut />

      <ul>
        <li><strong>Uptime (40%)</strong> — how reliably the mint has responded over the last 24 hours</li>
        <li><strong>NUT Support (15%)</strong> — how many of the tracked NUTs the mint supports</li>
        <li><strong>Version freshness (15%)</strong> — how far the mint's software is behind the newest stable release (two or more minor versions behind is "outdated")</li>
        <li><strong>Contact info (5%)</strong> — whether the operator has published a way to reach them</li>
        <li><strong>Audit reliability (25%)</strong> — real swap results from an independent auditor, counting only the failures attributed to the mint</li>
      </ul>
      <p>
        That audit signal comes from <strong><a href="https://cashu.info" target="_blank" rel="noopener noreferrer">cashu.info</a></strong> (the Cashu Mints Auditor), an independent third party that continuously runs real mint/melt swaps against known Cashu mints and publishes the results. MintRadar's own 5-minute checks only confirm a mint is reachable — they can't tell you whether its token operations are working correctly. The audit reliability score looks at the last 7 days of those swaps and counts only the failures cashu.info attributes to the mint itself. Failures it does not blame on the mint (an amount below the mint's minimum, the auditor's own balance, Lightning routing) are not held against it.
      </p>

      <h2>What each component actually measures</h2>
      <p>
        The five percentages above aren't arbitrary — each one reflects how much that signal tells you about whether a mint will actually work when you need it.
      </p>
      <ul>
        <li>
          <strong>Uptime — 40%.</strong> The share of MintRadar's 5-minute checks over the last 24 hours where the mint responded correctly. This carries the most weight because it's the most basic failure mode: a mint that's unreachable is unusable, full stop, regardless of how good its software or feature support otherwise is. No other signal matters if you can't reach the mint when you want to spend or redeem funds.
        </li>
        <li>
          <strong>Audit reliability — 25%.</strong> The share of the real mint/melt swaps run against the mint over the last 7 days whose failure cashu.info attributes to the mint. No attributed failures scores full marks; the more of its swaps fail through its own fault, the lower the score. This is weighted second-highest because it tests something uptime can't: whether the mint's actual token operations complete correctly, not just whether the server answers a ping. A mint can be "online" by MintRadar's own check and still fail real swaps. A mint with fewer than 10 swaps in that window, with no audit data, or whose stored audit data is more than 7 days old is scored neutral (12.5 of 25) rather than penalized for lack of data.
        </li>
        <li>
          <strong>NUT Support — 15%.</strong> The share of the tracked NUTs (the individual pieces of the Cashu spec — see the list above for the security-relevant ones) that the mint's <code>/v1/info</code> reports supporting. This is weighted lower than uptime and audit reliability because missing NUTs is a feature gap, not necessarily a sign the mint is broken or untrustworthy — but it does mean fewer safety nets (like NUT-09 restore or NUT-12 DLEQ proofs) are available to you.
        </li>
        <li>
          <strong>Version freshness — 15%.</strong> How far the mint's reported software version is behind the newest stable release of that software (Nutshell or cdk-mintd). Being on the latest release or one minor version behind earns the full 15 points; two minor versions behind earns 9, three 6, four 3 and five or more 0, and a mint two or more minor versions behind is labelled "outdated". Pre-releases of a current line (such as a release candidate) are not penalised. Recent versions carry security patches and bug fixes, but a slightly outdated version doesn't necessarily mean the mint is unsafe today — which is why this sits at the same modest weight as NUT support rather than higher.
        </li>
        <li>
          <strong>Contact info — 5%.</strong> Whether the operator has published a reachable channel (email, X/Twitter, or Nostr) in the mint's own <code>/v1/info</code>. This gets the smallest weight deliberately: it's operator-supplied information, not independently verified, so it's treated as a weak, easily-gamed signal rather than a strong indicator of trustworthiness on its own.
        </li>
      </ul>
      <p>
        No single number can tell you everything, so we also show a full breakdown — click on any mint's Reliability Score to see exactly what's contributing to it.
      </p>

      <KeyTakeaway>
        <strong>A high Reliability Score reduces risk — it doesn't eliminate it.</strong> The right mint is the one that fits what you actually need, not just whichever number is highest.
      </KeyTakeaway>

      <h2>Try it yourself</h2>
      <p>
        The fastest way to find a mint that fits what you need is the <strong>Best Mint Wizard</strong> in the Tools section. Tell it what matters most to you — speed, reliability, or feature support — and it'll recommend mints based on live data, not guesswork.
      </p>
      <Link to="/tools" className="learn-cta-btn">Try the Best Mint Wizard →</Link>
    </div>
  )
}
