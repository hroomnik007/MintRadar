import { KeyTakeaway } from '@/components/learn/KeyTakeaway'

export default function Module4() {
  return (
    <div className="learn-content">
      <h1>Getting Started with a Wallet</h1>

      <h3>Choosing your first wallet</h3>
      <p>
        Cashu has several solid wallet options — which one to start with mostly comes down to browser vs. native app, not one being "better." If you're new to Cashu, <strong><a href="https://cashu.me" target="_blank" rel="noreferrer">cashu.me</a></strong> is a good first stop: it runs in any browser with no installation, and can be saved to your phone's home screen like an app (a "Progressive Web App").
      </p>
      <p>
        If you'd rather have a native mobile app from the start, <strong><a href="https://minibits.cash" target="_blank" rel="noreferrer">Minibits</a></strong> (Android) and <strong><a href="https://enuts.cash" target="_blank" rel="noreferrer">eNuts</a></strong> (iOS/Android) are both established, actively maintained wallets — a genuine starting point, not just a fallback if cashu.me doesn't suit you.
      </p>

      <h3>Setting up your first mint</h3>
      <ol>
        <li>Open your wallet and look for an option to add a mint (usually "Add Mint" or a "+" button).</li>
        <li>Paste in the URL of the mint you chose — starting with <code>https://</code>.</li>
        <li>Your wallet will connect and fetch the mint's public keys. You're now ready to use it.</li>
      </ol>
      <p>
        <strong>Tip:</strong> if you're just testing things out and don't want to risk real sats yet, you can use <a href="https://testnut.cashu.space" target="_blank" rel="noreferrer"><code>testnut.cashu.space</code></a> — a public test mint that issues unbacked "fake" ecash for practice. These tokens have no real value and can't be exchanged for actual Bitcoin — nothing you do there can cost you real money, which makes it a safe place to get comfortable with the wallet before using a real mint.
      </p>

      <h3>Your first deposit</h3>
      <p>
        To fund your wallet, look for "Receive" or "Mint," choose an amount, and pay the Lightning invoice that's generated. Once it's confirmed, you'll have ecash tokens in your wallet.
      </p>

      <h3>Sending and receiving tokens</h3>
      <p>
        Sending ecash is different from a normal Bitcoin transaction — there's no address, no block confirmation. You generate a token (a long text string starting with <code>cashuA</code> or <code>cashuB</code>), and send it to someone however you like: paste it in a chat, show a QR code, even embed it in an emoji. The recipient pastes it into their own wallet to receive it.
      </p>
      <p>
        Because this doesn't touch the Lightning Network, it's instant and free — this is one of Cashu's biggest advantages for small, frequent payments.
      </p>

      <h3>Backing up your wallet</h3>
      <p>
        Most wallets, including cashu.me, generate a 12-word seed phrase (similar to a Bitcoin wallet). <strong>Write this down and store it somewhere safe.</strong>
      </p>
      <p>
        This is worth being blunt about: your seed phrase, combined with a mint that supports NUT-09 (Restore), is the <em>only</em> way to recover your funds if you lose your device. It doesn't matter if the mint is perfectly healthy and online — without your seed backed up, losing your phone means losing your ecash permanently. This is different from the mint-related risks in Module 2; this one is entirely on you to prevent, and entirely preventable.
      </p>

      <KeyTakeaway>
        <strong>Seed phrase + NUT-09 support = recoverable. No seed backup = permanent loss on device failure, no matter how trustworthy the mint is.</strong>
      </KeyTakeaway>
    </div>
  )
}
