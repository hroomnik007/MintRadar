import { Link } from 'react-router-dom'
import { TrustScoreDonut } from '@/components/learn/TrustScoreDonut'

export default function Module3() {
  return (
    <div className="learn-content">
      <h1>How to Choose a Mint</h1>

      <p>
        Now that you understand the risks, let's talk about how to actually pick a mint to use — and how MintRadar can help.
      </p>

      <h3>What to look for</h3>
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

      <h3>How MintRadar's Trust Score works</h3>
      <p>
        MintRadar combines several of these signals into a single Trust Score out of 100:
      </p>

      <TrustScoreDonut />

      <ul>
        <li><strong>Uptime (45%)</strong> — how reliably the mint has responded over the last 24 hours</li>
        <li><strong>NUT Support (30%)</strong> — how many of the tracked NUTs the mint supports</li>
        <li><strong>Version freshness (15%)</strong> — how close the mint's software is to the latest release</li>
        <li><strong>Contact info (5%)</strong> — whether the operator has published a way to reach them</li>
        <li><strong>Audit reliability (5%)</strong> — real transaction success data from an independent auditor</li>
      </ul>
      <p>
        No single number can tell you everything, so we also show a full breakdown — click on any mint's Trust Score to see exactly what's contributing to it.
      </p>

      <h3>Try it yourself</h3>
      <p>
        The fastest way to find a mint that fits what you need is the <strong>Best Mint Wizard</strong> in the Tools section. Tell it what matters most to you — speed, trust, or feature support — and it'll recommend mints based on live data, not guesswork.
      </p>
      <Link to="/tools" className="learn-cta-btn">Try the Best Mint Wizard →</Link>
    </div>
  )
}
