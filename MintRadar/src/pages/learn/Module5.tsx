import { KeyTakeaway } from '@/components/learn/KeyTakeaway'

export default function Module5() {
  return (
    <div className="learn-content">
      <h1>Safe Habits</h1>

      <p>
        A short list of habits that meaningfully reduce your risk when using Cashu day to day — roughly in order of how much they matter.
      </p>

      <h3>Keep your backup current</h3>
      <p>
        Start here: this is the one risk on this list that's entirely on you, not the mint. If you switch wallets or mints, make sure your seed phrase backup is up to date and stored somewhere safe — ideally offline, and definitely somewhere other than a screenshot on the same device you use daily. A mint can be perfectly healthy and it won't matter if you lose your device with no current backup.
      </p>

      <h3>Diversify across mints</h3>
      <p>
        This is your main defense against a mint disappearing or refusing to pay (Risk #1 from Module 2). Don't keep all your ecash in a single mint. If you regularly hold funds in Cashu, spreading them across two or three mints with good Trust Scores means a single mint failure doesn't wipe you out.
      </p>

      <h3>Check before you commit</h3>
      <p>
        Before sending a meaningful amount to a new mint, take thirty seconds to check its Trust Score and status on MintRadar. If it's offline, brand new with no history, or missing key security NUTs, that's useful information <em>before</em> you deposit — not after.
      </p>

      <h3>Redeem regularly</h3>
      <p>
        Cashu is designed for spending, not saving. Get in the habit of melting (redeeming) your ecash back to Lightning once balances grow past what you need for day-to-day spending. The longer funds sit in a mint, the longer you're exposed to that mint's risk.
      </p>

      <h3>Stay a little skeptical</h3>
      <p>
        Cashu is still young, experimental software. A healthy amount of skepticism — about new mints, about large balances, about anything that seems too convenient — will serve you well. The goal isn't to be afraid of using it. It's to use it the way it's meant to be used: like cash in your pocket, not your life savings.
      </p>

      <KeyTakeaway>
        <strong>If you only do one thing from this list: keep your seed backup current.</strong> Every other habit here reduces risk — a missing backup guarantees permanent loss the moment your device is gone.
      </KeyTakeaway>
    </div>
  )
}
