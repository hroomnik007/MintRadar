import { KeyTakeaway } from '@/components/learn/KeyTakeaway'

// Text as edited in the 2026-11-19 redesign (approved by the owner): commas instead of the dashes, the numbered steps as
// a four-part strip (a real sequence, so the numbers mean something; CSS draws them from the list's own counter).

export default function Module1() {
  return (
    <div className="learn-content">
      <h1>Cashu basics</h1>

      <h2>What is Cashu?</h2>
      <p>
        Cashu is a way to hold and send bitcoin that works differently from a normal wallet. Instead of your wallet tracking a balance on a shared ledger, you hold small digital tokens, like digital cash, on your own device.
      </p>
      <p>
        The core idea in one sentence: <strong>the mint holds the actual bitcoin and issues you ecash tokens that are a claim on it.</strong> You can send those tokens to anyone, instantly and without fees, and when you send them to another person the mint does not see who you are sending them to.
      </p>
      <p>
        That privacy applies to person-to-person transfers. When you deposit into a mint or redeem tokens back to Lightning (more in module 4), the mint does see the amount and the time, but it cannot link your token transfers to each other or to you.
      </p>

      <h2>How it works, without the maths</h2>
      <ol className="learn-flow">
        <li>You send bitcoin to a mint, usually over Lightning.</li>
        <li>The mint signs tokens of equal value without seeing them.</li>
        <li>You hold the tokens on your device.</li>
        <li>You send them to anyone; the mint never sees it.</li>
      </ol>
      <p>
        The signature is "blind": the mint signs your tokens without ever seeing what they look like. It can later prove that a token is valid, but it cannot link it back to you. Whoever receives the tokens can spend them again or redeem them back to bitcoin through the mint. This is called <strong>Chaumian ecash</strong>, after the cryptographer David Chaum, who invented it decades before Bitcoin.
      </p>

      <h2>How is this different from a normal Bitcoin wallet?</h2>
      <p>
        A regular Bitcoin wallet either holds your keys directly (self-custody) or holds a balance in someone else's database (custodial, like an exchange). Cashu is neither, exactly; it is something in between:
      </p>
      <ul>
        <li>The mint <strong>does</strong> hold your actual bitcoin, like a custodial wallet.</li>
        <li>But you hold <strong>bearer tokens</strong>, like physical cash: whoever has the token can spend it, and the mint does not track who owns what.</li>
      </ul>
      <p>
        This trade-off is the whole point of Cashu: you get cash-like privacy and instant transfers in exchange for leaving your funds with a mint operator.
      </p>

      <KeyTakeaway>
        The mint holds your bitcoin. You hold a bearer token. If the mint disappears, so does your bitcoin.
      </KeyTakeaway>
      <p>
        Keep this in mind as you go through the rest of this course: everything else builds on this one trade-off.
      </p>
    </div>
  )
}
