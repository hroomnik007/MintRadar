import { KeyTakeaway } from '@/components/learn/KeyTakeaway'
import { TokenFlowDiagram } from '@/components/learn/TokenFlowDiagram'

export default function Module1() {
  return (
    <div className="learn-content">
      <h1>Cashu Basics</h1>

      <h3>What is Cashu?</h3>
      <p>
        Cashu is a way to hold and send Bitcoin that works completely differently from a normal wallet. Instead of your wallet tracking a balance on a shared ledger, you hold small digital tokens — like digital cash — on your own device.
      </p>
      <p>
        Here's the core idea, in one sentence: <strong>the mint holds the actual Bitcoin, and issues you ecash tokens that represent a claim on that Bitcoin.</strong> You can send those tokens to anyone, instantly, with no fees, and — this is the important part — when you send tokens directly to another person, the mint doesn't see who you're sending them to.
      </p>
      <p>
        That privacy applies specifically to person-to-person transfers. When you deposit into a mint or redeem tokens back to Lightning (more on this in Module 4), the mint does see the amount and timing of that transaction — it just can't link your token transfers to each other or to you.
      </p>

      <h3>How it actually works (without the math)</h3>
      <ol>
        <li>You send Bitcoin (usually via Lightning) to a mint.</li>
        <li>The mint gives you back ecash tokens of equal value, using a cryptographic trick called a <strong>blind signature</strong>.</li>
        <li>Because the signature is "blind," the mint signs your tokens without ever seeing what they look like. This means the mint can prove the tokens are valid, but can't link them back to you later.</li>
        <li>You can send these tokens to anyone — over Nostr, a chat app, even an emoji — and the mint never sees the transaction happen.</li>
        <li>Whoever receives the tokens can spend them again, or redeem them back to Bitcoin/Lightning through the mint.</li>
      </ol>

      <TokenFlowDiagram />

      <p>
        This is called <strong>Chaumian ecash</strong>, named after cryptographer David Chaum, who invented the concept decades before Bitcoin existed.
      </p>

      <h3>How is this different from a normal Bitcoin wallet?</h3>
      <p>
        A regular Bitcoin wallet either holds your keys directly (self-custody) or holds a balance in someone else's database (custodial, like an exchange). Cashu is neither, exactly — it's something in between:
      </p>
      <ul>
        <li>The mint <strong>does</strong> hold your actual Bitcoin, similar to a custodial wallet.</li>
        <li>But you hold <strong>bearer tokens</strong>, similar to physical cash — whoever has the token can spend it, and the mint doesn't track who owns what.</li>
      </ul>
      <p>
        This trade-off is the whole point of Cashu: you get cash-like privacy and instant transfers, in exchange for trusting a mint operator with your funds.
      </p>

      <KeyTakeaway>
        <strong>The mint holds your Bitcoin. You hold a bearer token. If the mint disappears, so does your Bitcoin.</strong>
      </KeyTakeaway>
      <p>
        Keep this in mind as you go through the rest of this course — everything else builds on this one trade-off.
      </p>
    </div>
  )
}
