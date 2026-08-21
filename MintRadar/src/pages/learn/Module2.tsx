import { KeyTakeaway } from '@/components/learn/KeyTakeaway'

export default function Module2() {
  return (
    <div className="learn-content">
      <h1>Understanding the Risks</h1>

      <p>
        This is the most important module in this course. Read it before you put any real money into Cashu.
      </p>

      <h3>Risk #1: The mint could disappear or refuse to pay</h3>
      <p>
        Since the mint holds your actual Bitcoin, your ecash tokens are only worth something as long as the mint is online, honest, and willing to redeem them. If a mint operator shuts down their server, gets hacked, or simply decides to stop honoring tokens, the ecash in your wallet becomes worthless — instantly, with no recourse.
      </p>
      <p>
        This isn't a bug. It's the fundamental trade-off of the system. There is no insurance, no chargeback, no support ticket that gets your funds back.
      </p>

      <h3>Risk #2: You can't verify a mint has real backing</h3>
      <p>
        This is a limitation baked into the protocol itself, not a flaw in any particular mint's software. Because Cashu is designed so mints <em>can't</em> see what tokens they've issued to whom, there's currently no way for an outside observer — including tools like MintRadar — to cryptographically prove that a mint has enough real Bitcoin to back all the ecash it has issued.
      </p>
      <p>
        In theory, a mint could issue more ecash than it actually holds in reserve. If that happens, whoever tries to redeem their tokens last will find there's nothing left. This is sometimes called an <strong>exit scam</strong> or <strong>rug pull</strong>.
      </p>
      <p>
        The Cashu community is actively working on ways to make mint reserves verifiable (look up "Proof of Liabilities" if you want to go deeper), but as of today, this remains an open problem. Trust in a mint is still, to a significant degree, trust in its operator.
      </p>

      <h3>Risk #3: Software bugs</h3>
      <p>
        Cashu, the mint software, and the wallets built on top of it are still under active development. Bugs happen. A bug in a mint's implementation, or in your wallet, could cause you to lose funds even without any bad intent from anyone involved.
      </p>

      <h3>So how do you protect yourself?</h3>
      <p>
        You can't eliminate these risks, but you can manage them:
      </p>
      <ul>
        <li><strong>Never hold more in Cashu than you're willing to lose.</strong> Treat it like the cash in your physical wallet, not your savings account.</li>
        <li><strong>Spread funds across multiple mints</strong> instead of concentrating everything in one place. If one mint fails, you only lose what was there.</li>
        <li><strong>Redeem back to Lightning regularly</strong> instead of letting balances build up in a mint over time.</li>
        <li><strong>Pay attention to signals of mint health</strong> — this is where tools like MintRadar's Trust Score come in, which we'll cover in the next module.</li>
      </ul>
      <p>
        None of this makes Cashu "safe" in the way a bank account is safe. It makes it usable in a way that respects what it actually is: a privacy-focused, cash-like system with real trade-offs.
      </p>

      <KeyTakeaway>
        <strong>Treat Cashu like the cash in your physical wallet — never like your savings account.</strong> No mint, no matter how reputable, can currently prove it has real backing. Plan accordingly.
      </KeyTakeaway>
    </div>
  )
}
