# Archive of tools-page.md
> History only: sections moved out of `docs/claude/tools-page.md` because they describe superseded or removed behaviour. Do not read this for current rules.

### "Look up a mint" card — added then removed (2026-09-09 → 2026-09-10, commits `af595c4`/`efb19ec`)

A third Tools card (`MintLookup` component) briefly existed as an entry point into Mint Detail:
took a mint URL/hostname and navigated to `/mint/{encodeURIComponent(trimmed)}`, relying on
`resolveMintDetailUrl`'s existing bare-host canonicalization — no mint-info UI of its own. Removed
the next day: the component, its `.mint-lookup-*` CSS, the `#lookup` deep-link hash branch/anchor,
and the `tools-mint-lookup` e2e spec are all deleted. **At that time Tools had just the Wizard +
Inspector row** (a third card, the Payment request inspector, was added 2026-10-21, see below; it is not a mint lookup). `resolveMintDetailUrl` and the `/mint/:slug` route themselves are
untouched, so pasting a bare host into the address bar still resolves correctly; only the Tools-page
entry point for doing that was removed.
