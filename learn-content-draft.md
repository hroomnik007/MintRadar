# MintRadar Learn — Content Draft

---

## Module 1: Cashu Basics

### What is Cashu?

Cashu is a way to hold and send Bitcoin that works completely differently from a normal wallet. Instead of your wallet tracking a balance on a shared ledger, you hold small digital tokens — like digital cash — on your own device.

Here's the core idea, in one sentence: **the mint holds the actual Bitcoin, and issues you ecash tokens that represent a claim on that Bitcoin.** You can send those tokens to anyone, instantly, with no fees, and — this is the important part — when you send tokens directly to another person, the mint doesn't see who you're sending them to.

That privacy applies specifically to person-to-person transfers. When you deposit into a mint or redeem tokens back to Lightning (more on this in Module 4), the mint does see the amount and timing of that transaction — it just can't link your token transfers to each other or to you.

### How it actually works (without the math)

1. You send Bitcoin (usually via Lightning) to a mint.
2. The mint gives you back ecash tokens of equal value, using a cryptographic trick called a **blind signature**.
3. Because the signature is "blind," the mint signs your tokens without ever seeing what they look like. This means the mint can prove the tokens are valid, but can't link them back to you later.
4. You can send these tokens to anyone — over Nostr, a chat app, even an emoji — and the mint never sees the transaction happen.
5. Whoever receives the tokens can spend them again, or redeem them back to Bitcoin/Lightning through the mint.

This is called **Chaumian ecash**, named after cryptographer David Chaum, who invented the concept decades before Bitcoin existed.

### How is this different from a normal Bitcoin wallet?

A regular Bitcoin wallet either holds your keys directly (self-custody) or holds a balance in someone else's database (custodial, like an exchange). Cashu is neither, exactly — it's something in between:

- The mint **does** hold your actual Bitcoin, similar to a custodial wallet.
- But you hold **bearer tokens**, similar to physical cash — whoever has the token can spend it, and the mint doesn't track who owns what.

This trade-off is the whole point of Cashu: you get cash-like privacy and instant transfers, in exchange for trusting a mint operator with your funds.

### Key takeaway

> **The mint holds your Bitcoin. You hold a bearer token. If the mint disappears, so does your Bitcoin.**

Keep this in mind as you go through the rest of this course — everything else builds on this one trade-off.

---

## Module 2: Understanding the Risks

This is the most important module in this course. Read it before you put any real money into Cashu.

### Risk #1: The mint could disappear or refuse to pay

Since the mint holds your actual Bitcoin, your ecash tokens are only worth something as long as the mint is online, honest, and willing to redeem them. If a mint operator shuts down their server, gets hacked, or simply decides to stop honoring tokens, the ecash in your wallet becomes worthless — instantly, with no recourse.

This isn't a bug. It's the fundamental trade-off of the system. There is no insurance, no chargeback, no support ticket that gets your funds back.

### Risk #2: You can't verify a mint has real backing

This is a limitation baked into the protocol itself, not a flaw in any particular mint's software. Because Cashu is designed so mints *can't* see what tokens they've issued to whom, there's currently no way for an outside observer — including tools like MintRadar — to cryptographically prove that a mint has enough real Bitcoin to back all the ecash it has issued.

In theory, a mint could issue more ecash than it actually holds in reserve. If that happens, whoever tries to redeem their tokens last will find there's nothing left. This is sometimes called an **exit scam** or **rug pull**.

The Cashu community is actively working on ways to make mint reserves verifiable (look up "Proof of Liabilities" if you want to go deeper), but as of today, this remains an open problem. Trust in a mint is still, to a significant degree, trust in its operator.

### Risk #3: Software bugs

Cashu, the mint software, and the wallets built on top of it are still under active development. Bugs happen. A bug in a mint's implementation, or in your wallet, could cause you to lose funds even without any bad intent from anyone involved.

### So how do you protect yourself?

You can't eliminate these risks, but you can manage them:

- **Never hold more in Cashu than you're willing to lose.** Treat it like the cash in your physical wallet, not your savings account.
- **Spread funds across multiple mints** instead of concentrating everything in one place. If one mint fails, you only lose what was there.
- **Redeem back to Lightning regularly** instead of letting balances build up in a mint over time.
- **Pay attention to signals of mint health** — this is where tools like MintRadar's Trust Score come in, which we'll cover in the next module.

None of this makes Cashu "safe" in the way a bank account is safe. It makes it usable in a way that respects what it actually is: a privacy-focused, cash-like system with real trade-offs.

### Key takeaway

> **Treat Cashu like the cash in your physical wallet — never like your savings account.** No mint, no matter how reputable, can currently prove it has real backing. Plan accordingly.

---

## Module 3: How to Choose a Mint

Now that you understand the risks, let's talk about how to actually pick a mint to use — and how MintRadar can help.

### What to look for

**1. Uptime.** A mint that's frequently offline is one you can't rely on when you need to spend or redeem your funds. MintRadar checks every known mint every 5 minutes and tracks this over time.

**2. Software freshness.** Mint software gets bug fixes and security improvements regularly. A mint running a very outdated version may be missing important fixes.

**3. NUT support — especially the security-relevant ones.** "NUTs" are the individual pieces of the Cashu specification. Two are worth knowing by name:

- **NUT-09 (Restore):** lets you recover your ecash from just your wallet's seed phrase, even if you lose your device. Without it, losing your phone could mean losing your funds even if the mint is fine.
- **NUT-12 (DLEQ proofs):** lets your wallet cryptographically verify that the mint signed your tokens correctly, without needing to trust the mint's word for it.
- **NUT-11 (P2PK):** lets you lock ecash tokens so only a specific person (holding a specific key) can spend them — useful if you want to send funds that can't be redeemed by just anyone who intercepts them.

A mint missing these isn't necessarily malicious, but it does mean you're trusting it with less of a safety net.

**4. Operator transparency.** Does the mint publish contact information? Is there a real person or team behind it who can be reached? Anonymous mints aren't automatically untrustworthy, but a mint with no way to reach the operator is one you're trusting on faith alone.

### How MintRadar's Trust Score works

MintRadar combines several of these signals into a single Trust Score out of 100:

- **Uptime (45%)** — how reliably the mint has responded over the last 24 hours
- **NUT Support (30%)** — how many of the tracked NUTs the mint supports
- **Version freshness (15%)** — how close the mint's software is to the latest release
- **Contact info (5%)** — whether the operator has published a way to reach them
- **Audit reliability (5%)** — real transaction success data from an independent auditor

No single number can tell you everything, so we also show a full breakdown — click on any mint's Trust Score to see exactly what's contributing to it.

### Try it yourself

The fastest way to find a mint that fits what you need is the **Best Mint Wizard** in the Tools section. Tell it what matters most to you — speed, trust, or feature support — and it'll recommend mints based on live data, not guesswork.

*(This is where a live embed of the Best Mint Wizard, or a link to it, belongs directly in this lesson.)*

---

## Module 4: Getting Started with a Wallet

### Choosing your first wallet

Cashu has several wallet options. For your first time, we recommend **cashu.me** — it works in any browser, requires no installation, and can be saved to your phone's home screen like an app (a "Progressive Web App").

Other popular options include Minibits (Android) and eNuts (iOS/Android), if you'd prefer a native mobile app from the start.

### Setting up your first mint

1. Open your wallet and look for an option to add a mint (usually "Add Mint" or a "+" button).
2. Paste in the URL of the mint you chose — starting with `https://`.
3. Your wallet will connect and fetch the mint's public keys. You're now ready to use it.

**Tip:** if you're just testing things out and don't want to risk real sats yet, you can use `https://testnut.cashu.space` — a public test mint that issues unbacked "fake" ecash for practice. These tokens have no real value and can't be exchanged for actual Bitcoin — nothing you do there can cost you real money, which makes it a safe place to get comfortable with the wallet before using a real mint.

### Your first deposit

To fund your wallet, look for "Receive" or "Mint," choose an amount, and pay the Lightning invoice that's generated. Once it's confirmed, you'll have ecash tokens in your wallet.

### Sending and receiving tokens

Sending ecash is different from a normal Bitcoin transaction — there's no address, no block confirmation. You generate a token (a long text string starting with `cashuA` or `cashuB`), and send it to someone however you like: paste it in a chat, show a QR code, even embed it in an emoji. The recipient pastes it into their own wallet to receive it.

Because this doesn't touch the Lightning Network, it's instant and free — this is one of Cashu's biggest advantages for small, frequent payments.

### Backing up your wallet

Most wallets, including cashu.me, generate a 12-word seed phrase (similar to a Bitcoin wallet). **Write this down and store it somewhere safe.**

This is worth being blunt about: your seed phrase, combined with a mint that supports NUT-09 (Restore), is the *only* way to recover your funds if you lose your device. It doesn't matter if the mint is perfectly healthy and online — without your seed backed up, losing your phone means losing your ecash permanently. This is different from the mint-related risks in Module 2; this one is entirely on you to prevent, and entirely preventable.

### Key takeaway

> **Seed phrase + NUT-09 support = recoverable. No seed backup = permanent loss on device failure, no matter how trustworthy the mint is.**

---

## Module 5: Safe Habits

A short list of habits that meaningfully reduce your risk when using Cashu day to day.

### Diversify across mints

Don't keep all your ecash in a single mint. If you regularly hold funds in Cashu, spreading them across two or three mints with good Trust Scores means a single mint failure doesn't wipe you out.

### Redeem regularly

Cashu is designed for spending, not saving. Get in the habit of melting (redeeming) your ecash back to Lightning once balances grow past what you need for day-to-day spending. The longer funds sit in a mint, the longer you're exposed to that mint's risk.

### Check before you commit

Before sending a meaningful amount to a new mint, take thirty seconds to check its Trust Score and status on MintRadar. If it's offline, brand new with no history, or missing key security NUTs, that's useful information *before* you deposit — not after.

### Keep your backup current

If you switch wallets or mints, make sure your seed phrase backup is up to date and stored somewhere safe — ideally offline, and definitely somewhere other than a screenshot on the same device you use daily.

### Stay a little skeptical

Cashu is still young, experimental software. A healthy amount of skepticism — about new mints, about large balances, about anything that seems too convenient — will serve you well. The goal isn't to be afraid of using it. It's to use it the way it's meant to be used: like cash in your pocket, not your life savings.

---

*End of draft. Ready for review before conversion into JSX modules and Nostr long-form articles.*
